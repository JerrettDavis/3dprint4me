"""Exercise real Git archives; SSH is replaced only at the process boundary."""
import base64
import datetime
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / 'deploy/platform/release-partner.py'


class ReleaseChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not MODULE.is_file():
            return
        spec = importlib.util.spec_from_file_location('partner_release', MODULE)
        cls.release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.release)

    def setUp(self):
        self.assertTrue(MODULE.is_file(), 'partner-aware release builder is missing')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git('init', '--quiet')
        self.git('config', 'user.email', 'synthetic@example.invalid')
        self.git('config', 'user.name', 'Synthetic release test')
        for name in ['api/index.js', 'lib/index.js', 'neon/migrations/012_partner_outreach.sql',
                     'neon/migrations/013_partner_weekly_statements.sql',
                     'neon/migrations/014_work_communications.sql', 'neon/migrations/015_operator_model_revisions.sql',
                     'scripts/rehearse-partner.mjs', 'scripts/platform-server.mjs', 'deploy/platform/Dockerfile',
                     'deploy/platform/partner-release-host.py',
                     'deploy/platform/partner-rollout-host.py',
                     'deploy/slicer-worker/Dockerfile.bambu', 'public/assets/js/config.js',
                     'contracts/partner/manifest.json', 'package.json', 'package-lock.json']:
            p = self.repo / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('committed\n', encoding='utf-8', newline='\n')
        self.sha = self.commit()

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.repo, check=True,
                              capture_output=True).stdout.decode().strip()

    def commit(self):
        self.git('add', '.')
        self.git('commit', '--quiet', '-m', 'synthetic fixture')
        return self.git('rev-parse', 'HEAD')

    def test_archive_includes_contracts_and_excludes_local_changes(self):
        (self.repo / 'lib/index.js').write_text('uncommitted-secret', encoding='utf-8')
        (self.repo / 'private.env').write_text('private-secret', encoding='utf-8')
        payload = self.release.build_payload(self.sha, 'rehearse', self.repo)
        archive = base64.b64decode(payload['archive'], validate=True)
        self.assertEqual(payload['archiveSha256'], hashlib.sha256(archive).hexdigest())
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            self.assertIn('contracts/partner/manifest.json', tar.getnames())
            self.assertNotIn('private.env', tar.getnames())
            self.assertEqual(tar.extractfile('lib/index.js').read(), b'committed\n')
        self.assertNotIn(b'uncommitted-secret', archive)
        self.assertNotIn(b'private-secret', archive)

    def test_committed_slicer_env_example_is_not_a_build_input(self):
        example = self.repo / 'deploy/slicer-worker/.env.worker.example'
        example.write_text('EXAMPLE=only\n', encoding='utf-8')
        release = self.commit()
        payload = self.release.build_payload(release, 'rehearse', self.repo)
        with tarfile.open(fileobj=io.BytesIO(base64.b64decode(payload['archive']))) as tar:
            self.assertNotIn('deploy/slicer-worker/.env.worker.example', tar.getnames())

    def test_missing_contracts_fails_before_transport(self):
        self.git('rm', '-r', 'contracts')
        self.git('commit', '--quiet', '-m', 'missing contracts')
        with self.assertRaises(ValueError):
            self.release.build_payload(self.git('rev-parse', 'HEAD'), 'rehearse', self.repo)

    def test_missing_rollout_executor_fails_before_transport(self):
        self.git('rm', 'deploy/platform/partner-rollout-host.py')
        self.git('commit', '--quiet', '-m', 'missing rollout executor')
        with self.assertRaises(ValueError):
            self.release.build_payload(self.git('rev-parse', 'HEAD'), 'deploy', self.repo)

    def test_git_links_are_rejected(self):
        blob = subprocess.run(['git', 'hash-object', '-w', '--stdin'], input=b'../../private.env',
                              cwd=self.repo, capture_output=True, check=True).stdout.decode().strip()
        self.git('update-index', '--add', '--cacheinfo', f'120000,{blob},lib/linked')
        self.git('commit', '--quiet', '-m', 'linked input')
        with self.assertRaises(ValueError):
            self.release.build_payload(self.git('rev-parse', 'HEAD'), 'rehearse', self.repo)

    def test_invalid_release_and_phase_fail_closed(self):
        for sha, phase in [('HEAD', 'rehearse'), ('f'*39, 'deploy'),
                           ('f'*40, 'rehearse'), (self.sha, 'production')]:
            with self.subTest(sha=sha, phase=phase), self.assertRaises(ValueError):
                self.release.build_payload(sha, phase, self.repo)

    def test_transport_pins_host_and_sends_payload_only_in_stdin(self):
        secret = 'private-payload-sentinel'
        proof = {'phase': 'rehearse', 'status': 'passed', 'release': self.sha, 'archiveSha256': '0'*64,
                 'images': {'api': 'sha256:'+'a'*64, 'slicer': 'sha256:'+'b'*64},
                 'checks': {name: True for name in ['schema','leastPrivilege','disabledProgram','sessionDenials',
                           'noMessagesSent','isolatedApiOverlap','scratchCleanup','liveStateUnchanged']}}
        completed = subprocess.CompletedProcess([], 0, json.dumps(proof).encode(), b'')
        with patch.object(self.release.subprocess, 'run', return_value=completed) as run:
            result = self.release.send_payload('jd@jdh-docker-00', {'archive': secret, 'release': self.sha,
                                              'phase': 'rehearse', 'archiveSha256': '0'*64}, 'print(1)')
        args, kwargs = run.call_args
        self.assertIn('BatchMode=yes', args[0])
        self.assertIn('StrictHostKeyChecking=yes', args[0])
        self.assertNotIn(secret, str(args[0]))
        self.assertIn(secret.encode(), kwargs['input'])
        self.assertEqual(result, proof)

    def test_transport_rejects_incomplete_success_proof(self):
        completed = subprocess.CompletedProcess([], 0, b'{"phase":"rehearse","status":"passed"}', b'')
        with patch.object(self.release.subprocess, 'run', return_value=completed), self.assertRaises(RuntimeError):
            self.release.send_payload('jd@jdh-docker-00', {'release': self.sha, 'phase': 'rehearse'}, 'print(1)')

    def test_transport_rejects_host_options_and_sanitizes_child_errors(self):
        with patch.object(self.release.subprocess, 'run') as run:
            for host in ['-oProxyCommand=bad', 'jd@host;echo bad', 'host\nother', 'jd@host/path']:
                with self.subTest(host=host), self.assertRaises(ValueError):
                    self.release.send_payload(host, {}, 'print(1)')
            run.assert_not_called()
        completed = subprocess.CompletedProcess([], 1, b'private-stdout', b'private-stderr')
        with patch.object(self.release.subprocess, 'run', return_value=completed):
            with self.assertRaises(RuntimeError) as error:
                self.release.send_payload('jd@jdh-docker-00', {}, 'print(1)')
        self.assertNotIn('private-', str(error.exception))

    def test_transport_rejects_unexpected_nested_output(self):
        for proof in [{'phase': 'rehearse', 'status': 'passed', 'checks': {'password': 'private-secret'}},
                      {'phase': 'rehearse', 'status': 'passed', 'images': {'api': 'private-secret'}},
                      {'phase': 'rehearse', 'status': 'passed', 'release': 'private-secret'}]:
            result = subprocess.CompletedProcess([], 0, __import__('json').dumps(proof).encode(), b'')
            with self.subTest(proof=proof), patch.object(self.release.subprocess, 'run', return_value=result):
                with self.assertRaises(RuntimeError) as error:
                    self.release.send_payload('jd@jdh-docker-00', {}, 'print(1)')
                self.assertNotIn('private-secret', str(error.exception))

    def checkpoint_fixture(self, *, verified=True, ssh_host='jd@jdh-docker-00'):
        self.assertTrue(callable(getattr(self.release, 'collect_checkpoint', None)), 'fresh checkpoint collector is missing')
        result = {'version': 1, 'filename': '3dprint4me/platform-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.tar',
                  'sha256': 'a'*64, 'snapshots': ['b'*64,'c'*64], 'roundtrip_verified': True,
                  'databases': ['platform','platform_live_synthetic'], 'checkpoint_receipts': ['d'*64,'e'*64],
                  'private_objects': {'sha256':'f'*64,'snapshots':['a'*64,'b'*64],'roundtrip_verified':verified}}
        helper = self.repo/'deploy/platform/backup-controller.py'
        helper.write_text('import json\nfrom pathlib import Path\n'
                          'def private(path):\n assert path.is_file()\n'
                          'def backup(path):\n assert Path(__file__).with_name("export-backup.py").read_text()=="committed export"\n return json.loads('+repr(json.dumps(result))+')\n'
                          'def report(path,success):\n path.with_suffix(".reported").write_text(json.dumps(success))\n',encoding='utf-8',newline='\n')
        (self.repo/'deploy/platform/export-backup.py').write_text('committed export',encoding='utf-8')
        sha = self.commit()
        helper.write_text("raise RuntimeError('uncommitted-secret')",encoding='utf-8')
        config = self.repo/'backup.private.json'
        config.write_text(json.dumps({'ssh_host':ssh_host,'password_file':'owner-private-sentinel'}),encoding='utf-8')
        return sha, config

    def test_checkpoint_executes_only_committed_backup_and_export_code(self):
        sha, config = self.checkpoint_fixture()
        proof = self.release.collect_checkpoint(sha, config, self.repo, 'jd@jdh-docker-00')
        self.assertTrue(proof['roundtripVerified'])
        self.assertEqual(proof['databases'], ['platform','platform_live_synthetic'])
        self.assertEqual(proof['databaseSha256'], 'a'*64)
        self.assertEqual(proof['objectSha256'], 'f'*64)
        self.assertEqual(proof['checkpointReceipts'], ['d'*64,'e'*64])
        self.assertNotIn('private-sentinel', json.dumps(proof))
        self.assertNotIn('uncommitted-secret', json.dumps(proof))

    def test_checkpoint_rejects_incomplete_object_readback_and_wrong_host(self):
        sha, config = self.checkpoint_fixture(verified=False)
        with self.assertRaises(RuntimeError):
            self.release.collect_checkpoint(sha, config, self.repo, 'jd@jdh-docker-00')
        self.assertTrue(config.with_suffix('.reported').is_file(), 'failed checkpoint attempt must report failure')
        self.assertEqual(json.loads(config.with_suffix('.reported').read_text()), False)
        sha, config = self.checkpoint_fixture(ssh_host='jd@other-host')
        config.with_suffix('.reported').unlink(missing_ok=True)
        with self.assertRaises(RuntimeError):
            self.release.collect_checkpoint(sha, config, self.repo, 'jd@jdh-docker-00')
        self.assertFalse(config.with_suffix('.reported').exists(), 'mismatched custody must not report against another host')


class HostArchiveChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = ROOT / 'deploy/platform/partner-release-host.py'
        if cls.path.is_file():
            spec = importlib.util.spec_from_file_location('partner_release_host', cls.path)
            cls.host = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.host)

    def setUp(self):
        self.assertTrue(self.path.is_file(), 'safe partner host executor is missing')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)

    def payload(self, extra=None, rollout_code=None):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w') as tar:
            for name in ['deploy/platform/Dockerfile', 'deploy/platform/partner-release-host.py',
                         'deploy/platform/partner-rollout-host.py',
                         'deploy/slicer-worker/Dockerfile.bambu', 'contracts/partner/manifest.json',
                         'scripts/rehearse-partner.mjs', 'neon/migrations/012_partner_outreach.sql',
                         'neon/migrations/013_partner_weekly_statements.sql', 'neon/migrations/014_work_communications.sql',
                         'neon/migrations/015_operator_model_revisions.sql', 'package.json', 'package-lock.json']:
                member = tarfile.TarInfo(name)
                value = rollout_code.encode() if rollout_code and name == 'deploy/platform/partner-rollout-host.py' else b'safe'
                member.size = len(value)
                tar.addfile(member, io.BytesIO(value))
            if extra:
                tar.addfile(extra, io.BytesIO(b'evil') if extra.isfile() else None)
        archive = data.getvalue()
        return {'release': 'a'*40, 'phase': 'rehearse',
                'archive': base64.b64encode(archive).decode(),
                'archiveSha256': hashlib.sha256(archive).hexdigest()}

    def test_safe_source_is_complete_and_reused_only_when_identical(self):
        payload = self.payload()
        source = self.host.prepare_source(payload, root=self.root)
        self.assertEqual((source / 'contracts/partner/manifest.json').read_bytes(), b'safe')
        self.assertEqual(self.host.prepare_source(payload, root=self.root), source)
        (source / 'package.json').write_bytes(b'changed')
        with self.assertRaises(ValueError):
            self.host.prepare_source(payload, root=self.root)

    def test_digest_mismatch_does_not_create_release(self):
        payload = self.payload()
        payload['archiveSha256'] = '0'*64
        with self.assertRaises(ValueError):
            self.host.prepare_source(payload, root=self.root)
        self.assertFalse((self.root / 'releases').exists())

    def test_links_traversal_duplicate_and_unexpected_paths_are_rejected(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                           ('lib/link', tarfile.SYMTYPE), ('lib/hard', tarfile.LNKTYPE),
                           ('package.json', tarfile.REGTYPE), ('private.env', tarfile.REGTYPE),
                           ('lib/../escape', tarfile.REGTYPE), ('lib\\escape', tarfile.REGTYPE)]:
            member = tarfile.TarInfo(name)
            member.type = kind
            member.size = 4 if kind == tarfile.REGTYPE else 0
            member.linkname = '../../private.env' if kind != tarfile.REGTYPE else ''
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.host.prepare_source(self.payload(member), root=self.root)
        self.assertFalse((self.root / 'releases').exists())

    def test_partial_existing_release_is_not_trusted_or_overwritten(self):
        source = self.root / 'releases' / ('a'*40)
        source.mkdir(parents=True)
        (source / 'package.json').write_bytes(b'partial')
        with self.assertRaises(ValueError):
            self.host.prepare_source(self.payload(), root=self.root)
        self.assertEqual((source / 'package.json').read_bytes(), b'partial')

    def test_reuse_rejects_extra_nested_proof_file(self):
        payload = self.payload()
        source = self.host.prepare_source(payload, root=self.root)
        (source / 'deploy' / '.partner-release-proof.json').write_bytes(b'unreviewed')
        with self.assertRaises(ValueError):
            self.host.prepare_source(payload, root=self.root)

    def protocol(self, *, fail=None):
        self.assertTrue(callable(getattr(self.host, 'run_release', None)), 'native host rehearsal is missing')
        for name, values in [('api.env', {'DATABASE_URL': 'postgresql://platform_app:private-sentinel@postgres/platform_live_synthetic',
                                        'PLATFORM_CONTROL_DATABASE_URL': 'postgresql://platform_app:private-sentinel@postgres:5432/platform'}),
                             ('jobs.env', {}), ('compose.env', {'PLATFORM_RELEASE': 'old-release'}),
                             ('database-target.private.json', None)]:
            path = self.root / name
            path.write_text(json.dumps({}) if values is None else ''.join(k+'='+json.dumps(v)+'\n' for k,v in values.items()), encoding='utf-8')
            path.chmod(0o600)
        current = self.root / 'candidate-source'
        current.mkdir(mode=0o700)
        calls = []
        ids = {'postgres': 'a'*64, 'api': 'b'*64, 'jobs': '', 'slicer': 'c'*64, 'tunnel': 'd'*64}

        def runner(args, *, input=None, timeout=180):
            calls.append((args, input))
            if fail and fail(args, input):
                raise RuntimeError('private-sentinel provider failure')
            if args[:2] == ['docker', 'compose']:
                self.assertEqual(args[-3:-1], ['ps', '-q'])
                return ids[args[-1]]
            if args[:3] == ['docker', 'image', 'inspect']:
                return 'sha256:' + ('e' if 'platform:' in args[3] else 'f')*64
            if args[:2] == ['docker', 'inspect']:
                return json.dumps({'3dprint4me-platform_database': {}})
            if args[:3] == ['docker', 'network', 'inspect']:
                return 'true'
            if args[:2] == ['docker', 'exec'] and 'psql' in args:
                sql = input.decode()
                if 'SELECT database_name' in sql: return 'platform_live_synthetic'
                if 'SELECT count(*) FROM pg_database' in sql: return '0'
                return ''
            if args[:2] == ['docker', 'run']:
                if '--rm' in args:
                    return json.dumps({'schema': True, 'leastPrivilege': True, 'disabledProgram': True,
                                       'sessionDenials': True, 'noMessagesSent': True})
                return ('1' if 'node' in args else '2')*64
            if args[:2] == ['docker', 'logs']:
                return json.dumps({'checked': 48, 'failed': 0})
            if args[:2] == ['docker', 'ps']:
                return '1'*(64 if '--no-trunc' in args else 12)
            return ''
        return runner, calls

    def test_rehearsal_builds_both_tags_and_preserves_live_state(self):
        runner, calls = self.protocol()
        before = {p.name: p.read_bytes() for p in self.root.iterdir() if p.is_file()}
        with patch.object(self.host.time, 'sleep'):
            proof = self.host.run_release(self.payload(), root=self.root, runner=runner)
        self.assertEqual(proof['status'], 'passed')
        self.assertEqual(proof['phase'], 'rehearse')
        self.assertEqual(proof['images'], {'api': 'sha256:'+'e'*64, 'slicer': 'sha256:'+'f'*64})
        builds = [args for args, _ in calls if args[:2] == ['docker', 'build']]
        self.assertEqual(len(builds), 2)
        self.assertIn('3dprint4me-platform:aaaaaaaaaaaa', builds[0])
        self.assertIn('3dprint4me-slicer:aaaaaaaaaaaa', builds[1])
        self.assertTrue(proof['checks']['scratchCleanup'])
        self.assertTrue(proof['checks']['liveStateUnchanged'])
        for args, data in calls:
            self.assertNotIn('private-sentinel', str(args))
            if args[:2] == ['docker', 'compose']:
                self.assertNotIn('up', args)
                self.assertNotIn('stop', args)
        self.assertEqual({name: (self.root/name).read_bytes() for name in before}, before)
        self.assertNotIn('private-sentinel', json.dumps(proof))
        self.assertTrue(any(data and data.startswith(b'DROP DATABASE platform_partner_rehearsal_') for _,data in calls))

    def test_probe_failure_still_drops_only_scratch_database(self):
        runner, calls = self.protocol(fail=lambda args, data: args[:2] == ['docker', 'run'] and '--rm' in args)
        with self.assertRaises(RuntimeError) as error:
            self.host.run_release(self.payload(), root=self.root, runner=runner)
        self.assertNotIn('private-sentinel', str(error.exception))
        drops = [data.decode() for _,data in calls if data and data.startswith(b'DROP DATABASE')]
        self.assertEqual(len(drops), 1)
        self.assertTrue(drops[0].startswith('DROP DATABASE platform_partner_rehearsal_'))
        self.assertNotIn('platform_live_synthetic', drops[0])

    def test_live_enabled_flags_stop_before_build_or_database_commands(self):
        runner, calls = self.protocol()
        (self.root / 'api.env').write_text('PARTNER_PROGRAM_ENABLED="1"\n', encoding='utf-8')
        with self.assertRaises(RuntimeError):
            self.host.run_release(self.payload(), root=self.root, runner=runner)
        self.assertEqual(calls, [])

    def test_cleanup_failure_never_reports_success(self):
        runner, calls = self.protocol(fail=lambda args, data: bool(data and data.startswith(b'DROP DATABASE')))
        with patch.object(self.host.time, 'sleep'), self.assertRaises(RuntimeError):
            self.host.run_release(self.payload(), root=self.root, runner=runner)

    def test_rehearsal_uses_control_selection_when_bootstrap_overrides_legacy_business_url(self):
        runner, calls = self.protocol()
        path = self.root / 'api.env'
        path.write_text('DATABASE_URL="postgresql://legacy:private-sentinel@legacy.neon.tech/legacy"\n'
                        'PLATFORM_CONTROL_DATABASE_URL="postgresql://platform_app:private-sentinel@postgres:5432/platform"\n', encoding='utf-8')
        with patch.object(self.host.time, 'sleep'):
            proof = self.host.run_release(self.payload(), root=self.root, runner=runner)
        self.assertTrue(proof['checks']['liveStateUnchanged'])
        probe_input = next(data for args,data in calls if args[:2] == ['docker','run'] and '--rm' in args)
        self.assertIn('@postgres:5432/platform_partner_rehearsal_', probe_input.decode())
        self.assertNotIn('neon.tech', probe_input.decode())

    def test_overlap_failure_still_removes_only_scoped_probe_resources(self):
        runner, calls = self.protocol(fail=lambda args, data: args[:2] == ['docker', 'logs'])
        with patch.object(self.host.time, 'sleep'), self.assertRaises(RuntimeError):
            self.host.run_release(self.payload(), root=self.root, runner=runner)
        removals = [args for args,_ in calls if args[:3] == ['docker','rm','-f']]
        self.assertEqual(len(removals), 3)
        self.assertTrue(all(args[-1] == '1'*64 for args in removals))
        self.assertTrue(any(args[:3] == ['docker','network','rm'] for args,_ in calls))
        self.assertTrue(any(data and data.startswith(b'DROP DATABASE platform_partner_rehearsal_') for _,data in calls))

    def test_deploy_requires_checkpoint_before_any_host_command(self):
        runner, calls = self.protocol()
        payload = self.payload()
        payload['phase'] = 'deploy'
        with self.assertRaises(RuntimeError): self.host.run_release(payload, root=self.root, runner=runner)
        self.assertEqual(calls, [])

    def test_explicit_deploy_dispatches_private_context_only_after_complete_rehearsal(self):
        runner, calls = self.protocol()
        source = '''def checkpoint_ready(checkpoint, selected):
 assert checkpoint == {'readback':'verified'} and selected == 'platform_live_synthetic'
def deploy_release(context, *, runner):
 assert context['postgres'] == 'a'*64
 assert context['previous']['services']['api'] == 'b'*64
 assert context['rehearsalProof']['phase'] == 'rehearse'
 assert context['rehearsalProof']['checks']['scratchCleanup'] is True
 assert context['source'] == context['root']/'releases'/context['release']
 runner(['test-deploy-stage'])
 return {key:True for key in ['freshCheckpoint','guardedApi','jobsHandover','featureOffSmoke','existingServices']}
'''
        payload = self.payload(rollout_code=source)
        payload.update(phase='deploy', checkpoint={'readback':'verified'})
        with patch.object(self.host.time, 'sleep'), patch.object(self.host.sys, 'dont_write_bytecode', False):
            proof = self.host.run_release(payload, root=self.root, runner=runner)
        self.assertEqual(proof['phase'], 'deploy')
        self.assertEqual(self.host.prepare_source(payload, root=self.root), self.root/'releases'/payload['release'])
        self.assertTrue(proof['checks']['freshCheckpoint'])
        stage = next(i for i,(args,_) in enumerate(calls) if args == ['test-deploy-stage'])
        drop = next(i for i,(_,data) in enumerate(calls) if data and data.startswith(b'DROP DATABASE'))
        self.assertLess(drop, stage)
        self.assertNotIn('previous', proof)
        self.assertNotIn('private-sentinel', json.dumps(proof))
        calls.clear()
        def failed_probe(args, **kwargs):
            if args[:2] == ['docker','run'] and '--rm' in args:
                raise RuntimeError('synthetic probe unavailable')
            return runner(args, **kwargs)
        with self.assertRaises(RuntimeError):
            self.host.run_release(payload, root=self.root, runner=failed_probe)
        self.assertFalse(any(args == ['test-deploy-stage'] for args,_ in calls))


if __name__ == '__main__':
    unittest.main()
