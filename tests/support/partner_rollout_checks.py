"""Production mutation boundaries use a Docker protocol double, not a real host."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / 'deploy/platform/partner-rollout-host.py'
FLAGS = ('PARTNER_PROGRAM_ENABLED', 'PARTNER_CLASSIFICATION_APPROVED', 'PARTNER_ACCOUNTING_APPROVED')


class RolloutChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if MODULE.is_file():
            spec = importlib.util.spec_from_file_location('partner_rollout', MODULE)
            cls.module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.module)

    def setUp(self):
        self.assertTrue(MODULE.is_file(), 'guarded partner rollout executor is missing')
        self.temp = tempfile.TemporaryDirectory(prefix='partner-rollout-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        self.sha = '1'*40
        self.source = self.root / 'releases' / self.sha
        (self.source / 'neon/migrations').mkdir(parents=True)
        self.source.chmod(0o700)
        for name, text in [('012_partner_outreach.sql', 'CREATE TABLE partner_fixture_012(id uuid);'),
                           ('013_partner_weekly_statements.sql', 'CREATE TABLE partner_fixture_013(id uuid);'),
                           ('014_work_communications.sql', 'CREATE TABLE work_fixture_014(id uuid);'),
                           ('015_operator_model_revisions.sql', 'CREATE TABLE work_fixture_015(id uuid);')]:
            (self.source / 'neon/migrations' / name).write_text(text, encoding='utf-8')
        old = self.root / 'candidate-source'
        old.mkdir(mode=0o700)
        (old / 'old-source-marker').write_text('prior source', encoding='utf-8')
        self.api = {'PLATFORM_CONTROL_DATABASE_URL': 'postgresql://platform_app:private-sentinel@postgres:5432/platform',
                    'DATABASE_URL': 'postgresql://legacy:private-sentinel@source.invalid/retired',
                    'OPERATOR_OWNER_SUBJECT': '1234', 'GITHUB_CLIENT_SECRET': 'private-sentinel',
                    'INQUIRY_WORKFLOW_ENABLED': '1'}
        self.jobs = {'DATABASE_DRIVER': 'postgres', 'DATABASE_URL': 'postgresql://platform_app:private-sentinel@postgres:5432/platform_live_synthetic',
                     'PLATFORM_JOBS_ENABLED': '1'}
        for name, values in [('api.env', self.api), ('jobs.env', self.jobs),
                             ('compose.env', {'PLATFORM_RELEASE': 'old', 'PLATFORM_CONFIG_DIR': str(self.root)})]:
            path = self.root / name
            path.write_text(''.join(k+'='+json.dumps(v)+'\n' for k,v in values.items()), encoding='utf-8', newline='\n')
            path.chmod(0o600)
        self.services = {'api': 'b'*64, 'jobs': 'c'*64, 'slicer': 'd'*64, 'tunnel': 'e'*64}
        (self.root/'database-target.private.json').write_text('{"version":1,"phase":"prepared"}',encoding='utf-8')
        (self.root/'database-target.private.json').chmod(0o600)
        self.initial = dict(self.services)
        self.api_image = 'sha256:'+'f'*64
        self.running = {cid: True for cid in self.services.values()}
        self.images = {cid: 'sha256:'+'9'*64 for cid in self.services.values()}
        self.calls, self.fail, self.stuck_jobs, self.existing_guard = [], None, False, ''
        checkpoint = {'createdAt': int(time.time()), 'databases': ['platform', 'platform_live_synthetic'],
                      'databaseSha256': 'a'*64, 'databaseSnapshots': ['b'*64, 'c'*64],
                      'objectSha256': 'd'*64, 'objectSnapshots': ['e'*64, 'f'*64],
                      'checkpointReceipts': ['a'*64, 'b'*64], 'roundtripVerified': True}
        self.context = {'root': self.root, 'source': self.source, 'release': self.sha,
                        'selected': 'platform_live_synthetic', 'postgres': 'a'*64,
                        'images': {'api': self.api_image, 'slicer': 'sha256:'+'0'*64},
                        'previous': {'services': dict(self.services), 'source': str(old.resolve()),
                                     'selected': 'platform_live_synthetic',
                                     **{name: hashlib.sha256((self.root/name).read_bytes()).hexdigest()
                                        for name in ['api.env','jobs.env','compose.env','database-target.private.json']}},
                        'rehearsalProof': {'status': 'passed', 'phase':'rehearse','archiveSha256':'0'*64,'release': self.sha,
                                          'images': {'api': self.api_image, 'slicer': 'sha256:'+'0'*64},
                                          'checks': {key:True for key in ['schema','leastPrivilege','disabledProgram','sessionDenials',
                                                                         'noMessagesSent','isolatedApiOverlap','scratchCleanup','liveStateUnchanged']}},
                        'checkpoint': checkpoint}

    def runner(self, args, *, input=None, timeout=180):
        self.calls.append((args, input))
        if self.fail and self.fail(args, input):
            raise RuntimeError('private-sentinel injected failure')
        if args[:2] == ['docker', 'compose']:
            if 'ps' in args:
                if args[-1] == 'api_guard' and not any(value.endswith('.private.yml') for value in args):
                    raise ValueError('no such service: api_guard')
                return self.services.get(args[-1], '')
            if 'up' in args:
                name = args[-1]
                cid = {'api_guard': '1'*64, 'api': '2'*64, 'jobs': '3'*64}[name]
                self.services[name] = cid
                self.running[cid], self.images[cid] = True, self.api_image
            return ''
        if args[:2] == ['docker', 'inspect']:
            cid, fmt = args[2], args[-1]
            if 'NetworkSettings' in fmt:
                return json.dumps({'platform_database': {}, 'platform_egress': {}})
            if 'com.docker.compose.project' in fmt: return 'synthetic-platform'
            if fmt == '{{.Image}}': return self.images[cid]
            if fmt == '{{.State.Running}}': return str(self.running[cid]).lower()
            return self.images[cid] + ' ' + str(self.running[cid]).lower() + ' healthy'
        if args[:2] == ['docker', 'stop']:
            cid = args[-1]
            if not (self.stuck_jobs and cid == self.initial['jobs']): self.running[cid] = False
            return cid
        if args[:2] == ['docker', 'rm']:
            return args[-1]
        if args[:2] == ['docker', 'ps']:
            return self.existing_guard
        if args[:2] == ['docker', 'exec']:
            if 'psql' in args:
                return 'platform_live_synthetic' if input and b'SELECT database_name' in input else ''
            if args[2] in [self.services.get('api'), self.services.get('api_guard')]:
                return json.dumps({'featureOff': True, 'privateDenied': True, 'originDenied': True})
            return json.dumps({'nativeWriter': True, 'flagsOff': True, 'statementsHealthy': True})
        return ''

    def deploy(self):
        return self.module.deploy_release(self.context, runner=self.runner)

    def test_missing_stale_incomplete_or_wrong_database_checkpoint_stops_before_commands(self):
        for change in [None, {'createdAt': int(time.time())-3600}, {'roundtripVerified': False},
                       {'databases': ['platform', 'platform_live_other']}, {'checkpointReceipts': []}]:
            previous = self.context['checkpoint']
            self.context['checkpoint'] = None if change is None else {**previous, **change}
            with self.subTest(change=change), self.assertRaises(RuntimeError): self.deploy()
            self.assertEqual(self.calls, [])
            self.context['checkpoint'] = previous

    def test_disabled_rollout_preserves_unrelated_environment_and_service_order(self):
        proof = self.deploy()
        self.assertEqual(proof, {'freshCheckpoint': True, 'guardedApi': True, 'jobsHandover': True,
                                 'featureOffSmoke': True, 'existingServices': True})
        commands = [args for args,_ in self.calls]
        guard = next(i for i,args in enumerate(commands) if 'up' in args and args[-1] == 'api_guard')
        stop_jobs = next(i for i,args in enumerate(commands) if args[:2] == ['docker','stop'] and args[-1] == self.initial['jobs'])
        stop_api = next(i for i,args in enumerate(commands) if args[:2] == ['docker','stop'] and args[-1] == self.initial['api'])
        start_jobs = next(i for i,args in enumerate(commands) if 'up' in args and args[-1] == 'jobs')
        self.assertLess(guard, stop_jobs)
        self.assertLess(stop_jobs, stop_api)
        self.assertLess(stop_api, start_jobs)
        for name, original in [('api.env', self.api), ('jobs.env', self.jobs)]:
            values = self.module.read_env(self.root/name)
            self.assertEqual({k:v for k,v in values.items() if k not in FLAGS}, original)
            self.assertTrue(all(values[flag] == '0' for flag in FLAGS))
        self.assertEqual((self.root/'candidate-source').resolve(), self.source.resolve())
        self.assertTrue(any(p.name.startswith('source-before-partner-') and (p/'old-source-marker').is_file()
                            for p in (self.root/'releases').iterdir()))
        migrations = [(args,data.decode()) for args,data in self.calls if data and b'CREATE TABLE partner_fixture' in data]
        self.assertEqual(len(migrations), 1)
        args, sql = migrations[0]
        self.assertEqual(args[args.index('-d')+1], 'platform_live_synthetic')
        self.assertIn("BEGIN;SET LOCAL lock_timeout='5s';", sql)
        self.assertIn('partner_fixture_012', sql)
        self.assertIn('partner_fixture_013', sql)
        self.assertIn('work_fixture_014', sql)
        self.assertIn('work_fixture_015', sql)
        self.assertTrue(sql.endswith('COMMIT;'))
        self.assertNotIn('private-sentinel', json.dumps(proof))
        for args,_ in self.calls:
            self.assertNotIn('private-sentinel', str(args))
            if args[:2] in (['docker','stop'], ['docker','rm']):
                self.assertNotIn(self.initial['slicer'], args)
                self.assertNotIn(self.initial['tunnel'], args)

    def test_disabled_writer_stays_disabled(self):
        path = self.root/'jobs.env'
        path.write_text(path.read_text().replace('PLATFORM_JOBS_ENABLED="1"','PLATFORM_JOBS_ENABLED="0"'), encoding='utf-8')
        self.context['previous']['jobs.env'] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.context['previous']['services']['jobs'] = ''
        self.services['jobs'] = ''
        self.deploy()
        self.assertFalse(any('up' in args and args[-1] == 'jobs' for args,_ in self.calls))
        self.assertFalse(any(args[:2] == ['docker','stop'] and args[-1] == self.initial['jobs'] for args,_ in self.calls))

    def test_guard_readiness_failure_never_drains_previous_api_or_writers(self):
        self.fail = lambda args,data: 'up' in args and args[-1] == 'api_guard'
        with self.assertRaises(RuntimeError) as error: self.deploy()
        self.assertNotIn('private-sentinel', str(error.exception))
        self.assertFalse(any(args[:2] == ['docker','stop'] for args,_ in self.calls))
        self.assertFalse(any(data and b'DROP ' in data for _,data in self.calls))

    def test_stuck_previous_jobs_prevent_any_replacement_writer(self):
        self.stuck_jobs = True
        with self.assertRaises(RuntimeError): self.deploy()
        self.assertFalse(any('up' in args and args[-1] == 'jobs' for args,_ in self.calls))
        self.assertFalse(any(args[:2] == ['docker','stop'] and args[-1] == self.initial['api'] for args,_ in self.calls))

    def test_final_api_failure_preserves_healthy_guard_and_additive_schema(self):
        self.fail = lambda args,data: 'up' in args and args[-1] == 'api'
        with self.assertRaises(RuntimeError): self.deploy()
        self.assertTrue(self.running['1'*64])
        self.assertFalse(any(args[:2] == ['docker','stop'] and args[-1] == '1'*64 for args,_ in self.calls))
        self.assertFalse(any(data and any(word in data for word in [b'DROP ', b'TRUNCATE ', b'DELETE ']) for _,data in self.calls))

    def test_changed_environment_or_enabled_engagement_stops_before_schema(self):
        path = self.root/'api.env'
        with path.open('a') as f: f.write('PARTNER_PROGRAM_ENABLED="1"\n')
        with self.assertRaises(RuntimeError): self.deploy()
        self.assertFalse(any(data and b'CREATE TABLE' in data for _,data in self.calls))

    def test_incomplete_rehearsal_proof_stops_before_any_command(self):
        self.context['rehearsalProof']['checks'].pop('schema')
        with self.assertRaises(RuntimeError): self.deploy()
        self.assertEqual(self.calls, [])

    def test_changed_database_target_manifest_stops_before_any_command(self):
        (self.root/'database-target.private.json').write_text('{"version":1,"phase":"changed"}',encoding='utf-8')
        with self.assertRaises(RuntimeError): self.deploy()
        self.assertEqual(self.calls, [])

    def test_existing_guard_stops_retry_before_replacing_a_serving_origin(self):
        self.existing_guard = '1'*64
        with self.assertRaises(RuntimeError): self.deploy()
        self.assertFalse(any('up' in args for args,_ in self.calls))
        self.assertFalse(any(data and b'CREATE TABLE' in data for _,data in self.calls))
        self.assertFalse(list(self.root.glob('partner-rollout-*.private.json')))

    def test_each_external_failure_retains_additive_data_and_admitted_guard(self):
        boundaries = [
            ('compose-config', lambda args,data: args[-2:] == ['config','--quiet']),
            ('selected-migration', lambda args,data: bool(data and b'CREATE TABLE partner_fixture' in data)),
            ('guard-smoke', lambda args,data: args[:3] == ['docker','exec','1'*64]),
            ('guard-publish', lambda args,data: args[:3] == ['docker','network','connect'] and args[-1] == '1'*64),
            ('old-jobs-stop', lambda args,data: args[:2] == ['docker','stop'] and args[-1] == 'c'*64),
            ('old-api-stop', lambda args,data: args[:2] == ['docker','stop'] and args[-1] == 'b'*64),
            ('final-api-smoke', lambda args,data: args[:3] == ['docker','exec','2'*64]),
            ('final-api-publish', lambda args,data: args[:3] == ['docker','network','connect'] and args[-1] == '2'*64),
            ('writer-start', lambda args,data: 'up' in args and args[-1] == 'jobs'),
            ('writer-health', lambda args,data: args[:4] == ['docker','exec','-i','3'*64]),
            ('guard-drain', lambda args,data: args[:2] == ['docker','stop'] and args[-1] == '1'*64),
        ]
        for label, boundary in boundaries:
            with self.subTest(boundary=label):
                fixture = RolloutChecks('runTest')
                fixture.setUp()
                try:
                    injected = []
                    def fail(args,data):
                        if boundary(args,data):
                            injected.append(True)
                            return True
                        return False
                    fixture.fail = fail
                    with self.assertRaises(RuntimeError): fixture.deploy()
                    self.assertTrue(injected, 'failure boundary was not reached')
                    self.assertFalse(any(data and any(word in data for word in (b'DROP ',b'TRUNCATE ',b'DELETE ')) for _,data in fixture.calls))
                    if not fixture.running['b'*64]:
                        self.assertTrue(fixture.running['1'*64], 'guard must remain serving after old API drains')
                finally:
                    fixture.doCleanups()


if __name__ == '__main__':
    unittest.main()
