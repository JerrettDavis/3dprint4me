"""Slice generated vase fixtures with isolated Bambu CLI profiles and inspect mode evidence.

Run node scripts/verify-vase-geometry.mjs first. Official CLI reference:
https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage
"""
import argparse
import json
import os
import re
import subprocess
import zipfile
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--binary', default='C:/Program Files/Bambu Studio/bambu-studio.exe')
parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parents[1] / '.superpowers/vase-fixtures')
parser.add_argument('--only', nargs='*')
args = parser.parse_args()
root = args.directory.resolve()
reports = []
fixtures = [root / (name + '.3mf') for name in args.only] if args.only else sorted(root.glob('*.3mf'))
if not fixtures:
    raise SystemExit('No vase fixtures found. Run verify-vase-geometry.mjs first.')

for fixture in fixtures:
    name = fixture.stem
    with zipfile.ZipFile(fixture) as archive:
        provenance = json.loads(archive.read('Metadata/customizer.json'))
        project = json.loads(archive.read('Metadata/project_settings.config'))
    spiral = provenance['construction'] == 'solid'
    assert project['spiral_mode'] == ('1' if spiral else '0'), name
    if spiral:
        assert project['top_shell_layers'] == '0' and project['sparse_infill_density'] == '0%', name
    # Never reuse old G-code/results or trigger an overwrite dialog in the CLI.
    output = Path(tempfile.mkdtemp(prefix=name + '-slice-', dir=root))
    env = os.environ.copy()
    env['APPDATA'] = str(output / 'appdata')
    env['LOCALAPPDATA'] = str(output / 'localappdata')
    command = [args.binary, '--slice', '0', '--arrange', '0', '--orient', '0', '--debug', '2', '--outputdir', str(output), str(fixture)]
    report = {'name': name, 'construction': provenance['construction'], 'output': output.name}
    try:
        with (output / 'slicer.log').open('wb') as log:
            child = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=180, env=env,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        result_file = output / 'result.json'
        result = json.loads(result_file.read_text()) if result_file.exists() else {}
        report.update(exit=child.returncode, result=result.get('return_code'),
                      warnings=[plate.get('warning_message', '') for plate in result.get('sliced_plates', [])])
        gcode_files = list(output.rglob('*.gcode'))
        if gcode_files:
            gcode = gcode_files[0].read_text(errors='replace')
        else:
            gcode = ''
            for package in output.rglob('*.3mf'):
                with zipfile.ZipFile(package) as archive:
                    entries = [entry for entry in archive.namelist() if entry.endswith('.gcode')]
                    if entries:
                        gcode = archive.read(entries[0]).decode('utf8', errors='replace')
                        break
        simultaneous = sum(1 for line in gcode.splitlines() if line.startswith('G1 ')
                           and re.search(r'\b[XY]-?\d', line) and re.search(r'\bZ-?\d', line)
                           and re.search(r'\bE(?:\d|\.\d)', line))
        report['spiral_extrusion_moves'] = simultaneous
        report['gcode_bytes'] = len(gcode)
        if not gcode:
            report['inspection_error'] = 'No sliced G-code found.'
        elif spiral and simultaneous < 100:
            report['inspection_error'] = 'Solid output did not produce continuous spiral extrusion evidence.'
    except subprocess.TimeoutExpired:
        report.update(exit='timeout', result=None, warnings=['Slicer exceeded 180 seconds.'])
    reports.append(report)
    (root / 'vase-slicing-summary.json').write_text(json.dumps(reports, indent=2))
    print(json.dumps(report), flush=True)

if any(report.get('exit') != 0 or report.get('result') != 0 or any(report.get('warnings', []))
       or report.get('inspection_error') for report in reports):
    raise SystemExit(1)
