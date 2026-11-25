"""Fixed read-only host collector. Secrets live in its owner-only JSON config."""
import argparse
import hashlib
import hmac
import json
import math
import os
import re
from pathlib import Path
import secrets
import subprocess
import time
import urllib.request

APP_IDS = {'db-size': ('local', 'host'), 'db-connections': ('local', 'host'), **{f'rate-{name}-{scope}': ('application', 'application') for name in ('sessions', 'uploads') for scope in ('global', 'client')}}
FIELDS = {'id', 'used', 'limit', 'observedAt', 'periodStart', 'periodEnd', 'source', 'scope'}


def numeric(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def capacity_records(records):
    if not isinstance(records, list) or len(records) > len(APP_IDS):
        raise ValueError('Unexpected capacity')
    seen = set()
    for row in records:
        if not isinstance(row, dict) or set(row) not in (FIELDS, FIELDS | {'unlimited'}):
            raise ValueError('Unexpected capacity')
        metric = row['id']
        if metric not in APP_IDS or metric in seen or (row['source'], row['scope']) != APP_IDS[metric]:
            raise ValueError('Unexpected capacity')
        seen.add(metric)
        if not numeric(row['observedAt']) or row['observedAt'] > time.time_ns() // 1_000_000 + 60000:
            raise ValueError('Unexpected capacity')
        if any(row[key] is not None and not numeric(row[key]) for key in ('used', 'limit', 'periodStart', 'periodEnd')):
            raise ValueError('Unexpected capacity')
        if (row['periodStart'] is None) != (row['periodEnd'] is None) or row['periodStart'] is not None and row['periodEnd'] <= row['periodStart']:
            raise ValueError('Unexpected capacity')
        if 'unlimited' in row and (type(row['unlimited']) is not bool or row['unlimited'] and row['limit'] is not None):
            raise ValueError('Unexpected capacity')
    return records


def application_details(data):
    keys = {'database', 'provider', 'files', 'email', 'estimates', 'jobs'}
    if not isinstance(data, dict) or set(data) not in (keys, keys | {'capacity'}) or data['provider'] not in ('postgres', 'neon', 'unknown') or any(type(data[k]) is not bool for k in ('database', 'jobs')) or any(data[k] is not None and type(data[k]) is not bool for k in ('files', 'email', 'estimates')):
        raise ValueError('Unexpected evidence')
    capacity_records(data.get('capacity', []))
    return data


def cpu_sample():
    # Fixed proc path, bounded read, aggregate CPU line only. No process data.
    with open('/proc/stat') as handle:
        line = handle.readline(4096)
    fields = line.split()
    if fields[0] != 'cpu' or len(fields) < 5:
        raise ValueError('CPU unavailable')
    values = [int(value) for value in fields[1:9]]
    return sum(values), values[3] + (values[4] if len(values) > 4 else 0)


def cpu_percent(first, second):
    total, idle = second[0] - first[0], second[1] - first[1]
    return round(100 * (total - idle) / total, 2) if total > 0 and 0 <= idle <= total else None


def host_capacity(root):
    records = []
    def add(metric, used=None, limit=None):
        records.append({'id': metric, 'used': used, 'limit': limit, 'observedAt': time.time_ns() // 1_000_000, 'periodStart': None, 'periodEnd': None, 'source': 'local', 'scope': 'host'})
    try:
        disk = os.statvfs(root)
        add('host-disk', (disk.f_blocks - disk.f_bfree) * disk.f_frsize, disk.f_blocks * disk.f_frsize)
    except Exception:
        add('host-disk')
    try:
        with open('/proc/meminfo') as handle:
            lines = handle.read(16384).splitlines()
        memory = {key: int(value.split()[0]) * 1024 for key, value in (line.split(':', 1) for line in lines) if key in ('MemAvailable', 'MemTotal')}
        used, total = memory['MemTotal'] - memory['MemAvailable'], memory['MemTotal']
        if not 0 <= used <= total or total <= 0:
            raise ValueError('Memory unavailable')
        add('host-memory', used, total)
    except Exception:
        add('host-memory')
    try:
        first = cpu_sample()
        time.sleep(0.1)
        add('host-cpu', cpu_percent(first, cpu_sample()), 100)
    except Exception:
        add('host-cpu', None, 100)
    return records


def container_capacity(command):
    # Fixed services and scalar templates: never inspect environment or commands.
    observed = time.time_ns() // 1_000_000
    def record(metric, used, limit):
        return {'id': metric, 'used': used, 'limit': limit, 'observedAt': observed, 'periodStart': None, 'periodEnd': None, 'source': 'local', 'scope': 'host'}
    def run(args):
        result = subprocess.run(args, capture_output=True, timeout=12, check=True)
        if len(result.stdout) > 4096:
            raise ValueError('Container evidence bound')
        return result.stdout.decode('ascii').strip().splitlines()
    try:
        ids = run(command + ['ps', '-q', 'api', 'jobs', 'slicer'])
        if len(ids) != 3 or len(set(ids)) != 3 or any(not re.fullmatch('[0-9a-f]{64}', item) for item in ids):
            raise ValueError('Container evidence unavailable')
        limits = run(['docker', 'inspect', '--format', '{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}', *ids])
        usage = run(['docker', 'stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemUsage}}', *ids])
        if len(limits) != 3 or len(usage) != 3:
            raise ValueError('Container evidence unavailable')
        parsed_limits = [tuple(int(value) for value in line.split('|')) for line in limits]
        if any(len(row) != 2 or min(row) <= 0 for row in parsed_limits):
            raise ValueError('Container caps unavailable')
        memory = cpu = 0
        units = {'B': 1, 'KiB': 1024, 'MiB': 1024**2, 'GiB': 1024**3, 'kB': 1000, 'MB': 1000**2, 'GB': 1000**3}
        for line in usage:
            percent, mem = line.split('|')
            cpu_value = float(percent.removesuffix('%'))
            match = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)(B|KiB|MiB|GiB|kB|MB|GB)\s*/\s*[0-9.]+(?:B|KiB|MiB|GiB|kB|MB|GB)', mem.strip())
            if not numeric(cpu_value) or match is None:
                raise ValueError('Container usage unavailable')
            cpu += cpu_value
            memory += float(match[1]) * units[match[2]]
        memory_limit = sum(row[0] for row in parsed_limits)
        cpu_limit = sum(row[1] for row in parsed_limits) / 10000000
        if not all(numeric(value) for value in (memory, cpu, memory_limit, cpu_limit)):
            raise ValueError('Container usage unavailable')
        return [record('container-memory', memory, memory_limit), record('container-cpu', cpu, cpu_limit)]
    except Exception:
        return [record('container-memory', None, None), record('container-cpu', None, None)]


def private_file(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        raise ValueError("Private configuration required")
    return json.loads(path.read_text())


def collect(config):
    root = Path(config["platform_root"])
    if not root.is_absolute() or root.is_symlink() or root.resolve() != root or root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077:
        raise ValueError("Private platform root required")
    command = ["docker", "compose", "--env-file", str(root / "compose.env"), "-f", str(root / "candidate-source/deploy/platform/compose.yml")]
    details = {"database": False, "provider": "unknown", "files": False, "email": False, "estimates": False, "jobs": False}
    try:
        result = subprocess.run(command + ["exec", "-T", "api", "node", "scripts/platform-status.mjs"], capture_output=True, timeout=35, check=True)
        if len(result.stdout) > 12288:
            raise ValueError("Evidence bound")
        data = json.loads(result.stdout)
        details = application_details(data)
    except Exception:
        pass  # Missing application evidence remains failed, never guessed healthy.
    host = host_capacity(root)
    details['capacity'] = details.get('capacity', []) + host + container_capacity(command)
    # Preserve original health inputs for the incident monitor.
    try:
        disk = os.statvfs(root)
        details['diskFreePercent'] = round(100 * disk.f_bavail / max(1, disk.f_blocks), 2)
    except Exception:
        pass
    memory = next(row for row in host if row['id'] == 'host-memory')
    if memory['used'] is not None and memory['limit']:
        details['memoryUsedPercent'] = round(100 * memory['used'] / memory['limit'], 2)
    return details


def send(details, secret):
    if not isinstance(secret, str) or len(secret) < 48:
        raise ValueError("Status credential required")
    path = "/heartbeat/platform"
    body = json.dumps({"observedAt": time.time_ns() // 1_000_000, "nonce": secrets.token_hex(16), "details": details}, separators=(",", ":")).encode()
    if len(body) > 16384:
        raise ValueError('Evidence bound')
    signature = hmac.new(secret.encode(), path.encode() + b"\n" + body, hashlib.sha256).hexdigest()
    request = urllib.request.Request("https://status-api.3dprint4.me" + path, data=body, method="POST", headers={"Content-Type": "application/json", "X-Status-Signature": signature, "User-Agent": "3dprint4me-platform-monitor/1"})
    # No redirects and no retry of ambiguous report delivery.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
        if response.status != 200:
            raise ValueError("Evidence rejected")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    try:
        config = private_file(args.config)
        send(collect(config), config["secret"])
        print("Aggregate platform evidence recorded.")
    except Exception:
        raise SystemExit("Platform evidence collection failed; private diagnostics suppressed.")
