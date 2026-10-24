"""Static partner shell harness; API fixtures here do not replace native BDD."""
import os
import subprocess
import time
from contextlib import contextmanager
from tests.support.server import ROOT, free_port, request


@contextmanager
def running_partner_shell():
    port = free_port()
    process = subprocess.Popen(['node', 'scripts/partner-server.mjs'], cwd=ROOT,
                               env={**os.environ, 'PARTNER_PORT': str(port)},
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    origin = f'http://127.0.0.1:{port}'
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                if request(origin + '/')[0] == 200:
                    break
            except OSError:
                if process.poll() is not None:
                    raise RuntimeError('Partner shell exited before becoming ready')
                time.sleep(.08)
        else:
            raise TimeoutError('Partner shell did not become ready')
        yield origin
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
