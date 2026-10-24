"""Build both runtime images from the host's extracted release archive.

Uses repository source only, no private configuration or production access.
The Linux extractor runs in a disposable container so Windows cannot mask modes.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]


def main(prefix):
    def run(args, **kwargs):
        return subprocess.run(args, check=True, **kwargs)

    names = run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
                cwd=ROOT, capture_output=True).stdout.decode().split('\0')
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode='w') as tar:
        for name in sorted(set(names)):
            if name == 'deploy/slicer-worker/.env.worker.example':
                continue
            if not name or not (name in ('package.json', 'package-lock.json') or
                    name.startswith(('api/', 'lib/', 'neon/', 'scripts/', 'deploy/',
                                     'contracts/partner/', 'public/assets/js/'))):
                continue
            path = ROOT / name
            if path.is_symlink() or not path.is_file():
                raise RuntimeError('Unsupported source member')
            data = path.read_bytes()
            member = tarfile.TarInfo(name)
            member.size, member.mode = len(data), 0o644
            tar.addfile(member, io.BytesIO(data))
    raw = archive.getvalue()
    payload = {'release': 'a'*40, 'phase': 'rehearse',
               'archive': base64.b64encode(raw).decode(),
               'archiveSha256': hashlib.sha256(raw).hexdigest()}
    volume = 'partner-archive-' + uuid.uuid4().hex[:12]
    run(['docker', 'volume', 'create', volume], capture_output=True)
    try:
        with tempfile.TemporaryDirectory(prefix='partner-archive-input-') as directory:
            path = Path(directory)
            (path/'payload.json').write_text(json.dumps(payload), encoding='utf-8')
            (path/'extract.py').write_bytes((ROOT/'deploy/platform/partner-release-host.py').read_bytes())
            code = ("import importlib.util,json,pathlib;"
                    "s=importlib.util.spec_from_file_location('host','/input/extract.py');"
                    "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
                    "p=pathlib.Path('/source');p.chmod(0o700);"
                    "m.prepare_source(json.load(open('/input/payload.json')),root=p)")
            run(['docker', 'run', '--rm', '--network', 'none', '-v', volume+':/source',
                 '-v', str(path)+':/input:ro', 'python:3.12-slim', 'python', '-c', code])
        # Stream the exact Linux-extracted tree to BuildKit without a Windows copy.
        for kind, dockerfile in [('api', 'deploy/platform/Dockerfile'),
                                 ('slicer', 'deploy/slicer-worker/Dockerfile.bambu')]:
            producer = subprocess.Popen(['docker', 'run', '--rm', '--network', 'none',
                '-v', volume+':/source:ro', 'python:3.12-slim', 'tar', '-C',
                '/source/releases/'+'a'*40, '-cf', '-', '.'], stdout=subprocess.PIPE)
            try:
                result = subprocess.run(['docker', 'build', '-t', prefix+'-'+kind,
                    '-f', dockerfile, '-'], stdin=producer.stdout)
                producer.stdout.close()
                assert producer.wait(timeout=60) == 0, 'Archive stream failed'
                result.check_returncode()
            finally:
                if producer.poll() is None:
                    producer.kill()
                    producer.wait()
            script = ("const fs=await import('node:fs');"
                      "if(process.getuid()===0)throw Error('Root runtime');"
                      "JSON.parse(fs.readFileSync('package.json'));"
                      "await import('./lib/partner-outreach/application.js');")
            if kind == 'api':
                script += "await import('./scripts/rehearse-partner.mjs');"
            else:
                script += ("fs.accessSync('scripts/print-estimate-worker.mjs',fs.constants.R_OK);"
                           "fs.accessSync(process.env.SLICER_BIN,fs.constants.X_OK);"
                           "JSON.parse(fs.readFileSync(process.env.SLICER_MACHINE_PROFILE));")
            run(['docker', 'run', '--rm', '--network', 'none', '--read-only',
                 '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                 '--entrypoint', 'node', prefix+'-'+kind, '--input-type=module', '-e', script])
        print(json.dumps({'archiveExtraction': 'linux', 'api': 'passed', 'slicer': 'passed',
                          'nonRoot': True, 'productionContacted': False}))
    finally:
        run(['docker', 'volume', 'rm', volume], capture_output=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image-prefix', default='3dprint4me-partner-archive-ci')
    main(parser.parse_args().image_prefix)
