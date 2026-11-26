import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch
SPEC=importlib.util.spec_from_file_location('collector',Path(__file__).parents[2]/'deploy/platform/status-collector.py')
c=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(c)
class CapacityTests(unittest.TestCase):
 def test_exact_application_schema(self):
  base={'database':True,'provider':'postgres','files':None,'email':False,'estimates':None,'jobs':True,'capacity':[]}
  self.assertEqual(c.application_details(base),base)
  with self.assertRaises(ValueError):c.application_details({**base,'private':'secret'})
  with self.assertRaises(ValueError):c.application_details({**base,'capacity':[{'id':'customer-id'}]})
 def test_finite_allowlisted_metrics(self):
  item={'id':'db-size','used':3,'limit':None,'observedAt':100,'periodStart':None,'periodEnd':None,'source':'local','scope':'host'}
  self.assertEqual(c.capacity_records([item]),[item])
  for changes in ({'used':float('nan')},{'id':'secret'},{'source':'provider'},{'used':True},{'extra':'secret'}):
   with self.assertRaises(ValueError):c.capacity_records([{**item,**changes}])
 def test_bound_before_network(self):
  with patch.object(c.urllib.request,'build_opener') as opener:
   with self.assertRaises(ValueError):c.send({'capacity':'a'*17000},'s'*48)
   opener.assert_not_called()
 def test_signed_bytes_are_exact_bounded_heartbeat(self):
  import hashlib,hmac,json
  from types import SimpleNamespace
  opener=unittest.mock.MagicMock()
  opener.open.return_value.__enter__.return_value=SimpleNamespace(status=200)
  with patch.object(c.urllib.request,'build_opener',return_value=opener):c.send({'capacity':[]},'s'*48)
  request=opener.open.call_args.args[0]
  self.assertLessEqual(len(request.data),16384)
  self.assertEqual(json.loads(request.data)['details'],{'capacity':[]})
  signature=hmac.new(('s'*48).encode(),b'/heartbeat/platform\n'+request.data,hashlib.sha256).hexdigest()
  self.assertEqual(request.get_header('X-status-signature'),signature)
 def test_optional_container_failure_is_unknown(self):
  with patch.object(c.subprocess,'run',side_effect=RuntimeError('private detail')):rows=c.container_capacity(['docker','compose'])
  self.assertTrue(all(row['used'] is None and row['limit'] is None for row in rows))
  self.assertNotIn('private detail',str(rows))
 def test_cpu_delta(self):
  self.assertEqual(c.cpu_percent((100,30),(200,50)),80)
  self.assertIsNone(c.cpu_percent((100,30),(100,30)))
 def test_writable_disk_capacity_excludes_reserved_blocks(self):
  from types import SimpleNamespace
  disk=SimpleNamespace(f_blocks=100,f_bfree=30,f_bavail=20,f_frsize=4096)
  with patch.object(c.os,'statvfs',return_value=disk,create=True),patch.object(c,'cpu_sample',side_effect=ValueError):
   row=c.host_capacity(Path('/'))[0]
  self.assertEqual(row['used'],70*4096)
  self.assertEqual(row['limit']-row['used'],20*4096)
 def test_numeric_safety_and_receiver_clock_skew(self):
  self.assertFalse(c.numeric(2**53))
  item={'id':'db-size','used':3,'limit':None,'observedAt':131000,'periodStart':None,'periodEnd':None,'source':'local','scope':'host'}
  with patch.object(c.time,'time_ns',return_value=100000000000):
   with self.assertRaises(ValueError):c.capacity_records([item])
 def test_container_commands_never_read_environment(self):
  from types import SimpleNamespace
  calls=[]
  def run(args,**kwargs):
   calls.append(args)
   if 'ps' in args:return SimpleNamespace(stdout=('a'*64+'\n'+'b'*64+'\n'+'c'*64+'\n').encode())
   if 'inspect' in args:return SimpleNamespace(stdout=b'536870912|1000000000\n536870912|1000000000\n2147483648|2000000000\n')
   return SimpleNamespace(stdout=b'10%|10MiB / 512MiB\n20%|20MiB / 512MiB\n30%|30MiB / 2GiB\n')
  with patch.object(c.subprocess,'run',side_effect=run):rows=c.container_capacity(['docker','compose'])
  self.assertEqual(rows[0]['used'],60*1024*1024)
  self.assertEqual(rows[0]['limit'],3*1024*1024*1024)
  self.assertEqual(rows[1]['used'],60)
  self.assertEqual(rows[1]['limit'],400)
  self.assertEqual(calls[0][-3:],['api','jobs','slicer'])
  self.assertNotIn('Env',' '.join(' '.join(args) for args in calls))
if __name__=='__main__':unittest.main()
