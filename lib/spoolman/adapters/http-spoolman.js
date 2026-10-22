// Server-only, read-only provider. A single complete response avoids paging races.
const unavailable = () => Object.assign(new Error('Spoolman is temporarily unavailable.'), { code: 'spoolman_unavailable' });
export function createSpoolmanProvider({ baseUrl, hostHeader, fetchImpl = fetch } = {}) {
  if (!baseUrl) return { configured: false, async snapshot() { throw unavailable(); } };
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Invalid Spoolman server configuration.');
  if (hostHeader && !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(hostHeader)) throw new Error('Invalid Spoolman Host configuration.');
  return { configured: true, async snapshot({ signal } = {}) {
    const boundedSignal = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
    let bytes = 0;
    async function read(path) {
      const response = await fetchImpl(new URL(path, base), { method: 'GET', redirect: 'error', signal: boundedSignal, headers: { Accept: 'application/json', ...(hostHeader ? { Host: hostHeader } : {}) } });
      if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); throw unavailable(); }
      const reader = response.body.getReader(), chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 16 * 1024 * 1024) throw unavailable();
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')), total: response.headers.get('x-total-count') };
    }
    try {
      const setting = (await read('/api/v1/setting/currency')).value;
      const currency = JSON.parse(setting.value);
      if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw unavailable();
      const { value: spools, total } = await read('/api/v1/spool?allow_archived=true');
      if (!Array.isArray(spools) || spools.length > 5000 || !/^\d+$/.test(total ?? '') || Number(total) !== spools.length) throw unavailable();
      return { currency, spools };
    } catch { throw unavailable(); }
  } };
}
