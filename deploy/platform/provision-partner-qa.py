"""Private config wrapper. Never accepts credentials on the command line."""
import argparse
import subprocess
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument('--config', required=True)
parser.add_argument('--phase', choices=['preflight', 'apply'], default='preflight')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
raise SystemExit(subprocess.call(['node', str(root / 'scripts/provision-partner-qa.mjs'), str(Path(args.config).resolve()), args.phase], cwd=root))
