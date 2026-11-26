"""Private bounded functional runner, invoked by the existing host collector."""
import json
import os
import re
from pathlib import Path
import selectors
import subprocess
import time

DAY=86400000

def read_state(path):
    if path.is_symlink():
        raise ValueError('Private state required')
    if not path.exists():
        return None
    stat=path.stat()
    if not path.is_file() or stat.st_nlink!=1 or stat.st_size>32768:
        raise ValueError('Private state required')
    if os.name=='posix' and (stat.st_uid!=os.getuid() or stat.st_mode & 0o077):
        raise ValueError('Private state required')
    return json.loads(path.read_text())

def write_state(path,state):
    data=json.dumps(state,separators=(',',':')).encode()
    if len(data)>32768:
        raise ValueError('State bound')
    temporary=path.with_name('.'+path.name+'.'+os.urandom(8).hex())
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
    try:
        with os.fdopen(fd,'wb') as handle:
            handle.write(data);handle.flush();os.fsync(handle.fileno())
        os.replace(temporary,path)
        if os.name=='posix':
            directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if temporary.exists():
            temporary.unlink()

def repair_allowed(state,safety,now):
    if not isinstance(safety,dict) or any(safety.get(k) is not True for k in ('database','unpaused','noLeases','noSliceLeases')):
        return None
    report=state.get('public',{})
    if report.get('lastRepairAt') is not None and now-report['lastRepairAt']<3600000:
        return None
    attempts=report.get('repairAttempts',0) if now-state.get('repairWindowAt',now)<DAY else 0
    if type(attempts) is not int or not 0<=attempts<3:
        return None
    stale=safety.get('staleServices',[])
    return next((name for name in ('jobs','slicer') if name in stale),None)

def service_can_start(state):
    # Observed lease absence cannot fence a live claimant. Starting an already
    # stopped service cannot interrupt newly claimed customer work; restarting a
    # running service could. Unknown and running services therefore fail closed.
    return isinstance(state,dict) and state.get('running') is False

def verify_recovery(state,safety):
    report=state.get('public',{})
    if not isinstance(safety,dict) or report.get('repairService') not in safety.get('healthyServices',[]):
        return
    if report.get('repairOutcome') not in ('started','failed','guarded'):
        return
    since=report.get('lastRepairAt') or 0
    if (report.get('filesOk') is True and report.get('estimatesOk') is True
            and (report.get('filesVerifiedAt') or 0)>=since
            and (report.get('estimatesVerifiedAt') or 0)>=since):
        report['repairOutcome']='verified'

def run(config,command):
    if config.get('functional_enabled') is not True:
        return None
    import fcntl
    root=Path(config['platform_root'])
    state_path=root/'status-functional.private.json'
    # This is the release protocol's own lock. Holding it excludes a guarded
    # deployment throughout probing, precondition checks and a possible restart.
    fd=os.open(root/'.partner-release.lock',os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as lock:
        stat=os.fstat(lock.fileno())
        if stat.st_uid!=os.getuid() or stat.st_mode & 0o077 or stat.st_nlink!=1:
            raise ValueError('Private release lock required')
        try:
            fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            previous=read_state(state_path)
            return previous.get('public') if previous else None
        state=read_state(state_path)
        args=command+['exec','-T','api','node','scripts/platform-functional-probe.mjs']
        process=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        safety=None
        try:
            process.stdin.write((json.dumps({'state':state,'emailEnabled':config.get('receipt_enabled') is True})+'\n').encode())
            process.stdin.flush()
            selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ)
            deadline=time.monotonic()+100
            pending=b'';total=0
            while selector.get_map() and time.monotonic()<deadline:
                for key,_ in selector.select(timeout=min(1,max(0,deadline-time.monotonic()))):
                    chunk=os.read(key.fileobj.fileno(),4096)
                    if not chunk:
                        selector.unregister(key.fileobj);break
                    total+=len(chunk)
                    if total>512*1024:
                        raise ValueError('Checkpoint bound')
                    pending+=chunk
                    if len(pending)>32768 and b'\n' not in pending:
                        raise ValueError('Checkpoint bound')
                    while b'\n' in pending:
                        line,pending=pending.split(b'\n',1)
                        if len(line)>32768:
                            raise ValueError('Checkpoint bound')
                        value=json.loads(line)
                        if set(value)=={'repairSafety'}:
                            safety=value['repairSafety'];continue
                        if value.get('version')!=1 or not isinstance(value.get('public'),dict):
                            raise ValueError('Invalid checkpoint')
                        state=value;write_state(state_path,state)
                        process.stdin.write(b'checkpoint-ok\n');process.stdin.flush()
            if selector.get_map():
                raise TimeoutError('Bounded functional probe timed out')
            process.wait(timeout=5)
            if process.returncode or not state:
                raise ValueError('Functional probe unavailable')
            now=time.time_ns()//1000000
            verify_recovery(state,safety)
            write_state(state_path,state)
            service=repair_allowed(state,safety,now)
            if service:
                # Fail closed when a guard exists. Fixed project/service filter;
                # never enumerate credentials or container environment.
                guards=subprocess.run(['docker','ps','-aq','--filter','label=com.docker.compose.project=3dprint4me-platform','--filter','label=com.docker.compose.service=api_guard'],capture_output=True,check=True,timeout=10)
                ids=subprocess.run(command+['ps','--all','--quiet',service],capture_output=True,check=True,timeout=10).stdout.decode('ascii').strip().splitlines()
                stopped=False
                if len(ids)==1 and re.fullmatch(r'[a-f0-9]{64}',ids[0]):
                    flag=subprocess.run(['docker','inspect','--format','{{.State.Running}}',ids[0]],capture_output=True,check=True,timeout=10).stdout.decode('ascii').strip()
                    stopped=service_can_start({'running':False if flag=='false' else True})
                if not guards.stdout.strip() and stopped:
                    if now-state.get('repairWindowAt',now)>=DAY:
                        state['public']['repairAttempts']=0
                    state.setdefault('repairWindowAt',now)
                    if now-state['repairWindowAt']>=DAY:
                        state['repairWindowAt']=now
                    report=state['public'];report['lastRepairAt']=now;report['repairAttempts']+=1
                    report['repairService']=service;report['repairOutcome']='failed'
                    write_state(state_path,state) # Reserve cooldown before mutation.
                    result=subprocess.run(command+['start',service],capture_output=True,timeout=65)
                    report['repairOutcome']='started' if result.returncode==0 else 'failed'
                    state['nextCheckAt']=now
                    report['nextCheckAt']=now
                    write_state(state_path,state)
                else:
                    state['public']['repairService']=service
                    state['public']['repairOutcome']='guarded'
                    write_state(state_path,state)
            return state['public']
        except Exception:
            # Preserve checkpoint times. A partial/failed run cannot manufacture
            # success, and a pending send is handled as ambiguous next time.
            previous=read_state(state_path)
            return previous.get('public') if previous else None
        finally:
            try:
                process.stdin.close()
            except (BrokenPipeError,OSError):
                pass
            if process.poll() is None:
                process.kill();process.wait(timeout=5)
