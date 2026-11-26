import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('functional_host', Path(__file__).parents[2] / 'deploy/platform/status-functional.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)

class FunctionalRecoveryTests(unittest.TestCase):
    def test_recovery_never_interrupts_a_running_or_unknown_service(self):
        self.assertTrue(m.service_can_start({'running': False}))
        for state in ({'running':True},{},{'running':None},{'running':'false'}):
            self.assertFalse(m.service_can_start(state))

    def test_recovery_requires_fresh_workflow_success_after_a_start(self):
        state={'public':{'repairService':'jobs','repairOutcome':'started','lastRepairAt':1000,'filesVerifiedAt':900,'estimatesVerifiedAt':900,'filesOk':True,'estimatesOk':True}}
        safe={'healthyServices':['jobs']}
        m.verify_recovery(state,safe)
        self.assertEqual(state['public']['repairOutcome'],'started')
        state['public'].update(filesVerifiedAt=1100,estimatesVerifiedAt=1200)
        m.verify_recovery(state,safe)
        self.assertEqual(state['public']['repairOutcome'],'verified')
    def test_restarts_require_authoritative_preconditions_and_honor_caps(self):
        now=1795670000000
        state={'public': {'lastRepairAt': None, 'repairAttempts': 0}, 'repairWindowAt': now}
        safe={'database':True,'unpaused':True,'noLeases':True,'noSliceLeases':True,'staleServices':['jobs']}
        self.assertEqual(m.repair_allowed(state,safe,now),'jobs')
        for key in ('database','unpaused','noLeases','noSliceLeases'):
            self.assertIsNone(m.repair_allowed(state,{**safe,key:False},now))
        self.assertIsNone(m.repair_allowed(state,{**safe,'staleServices':['api']},now))
        state['public']['lastRepairAt']=now-3599999
        self.assertIsNone(m.repair_allowed(state,safe,now))
        state['public']['lastRepairAt']=None
        state['public']['repairAttempts']=3
        self.assertIsNone(m.repair_allowed(state,safe,now))

    def test_private_state_rejects_symlink_and_permissive_mode(self):
        import os,tempfile
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'state.json'
            p.write_text('{}')
            if os.name=='posix':
                p.chmod(0o644)
                with self.assertRaises(ValueError):m.read_state(p)
                p.chmod(0o600)
            self.assertEqual(m.read_state(p),{})
            if os.name=='posix':
                link=Path(directory)/'link.json';link.symlink_to(p)
                with self.assertRaises(ValueError):m.read_state(link)
