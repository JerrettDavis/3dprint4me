import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProduct } from '../../public/assets/js/catalogue/contract.js';
import { catalogueConfigurationHash } from './domain.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (path, parent) => path.toLowerCase() === parent.toLowerCase() || path.toLowerCase().startsWith(parent.toLowerCase() + sep);
export function cataloguePrivateRoot(value = process.env.CATALOGUE_PRIVATE_PATH || resolve(root, '.private/catalogue-jobs')) {
  const target = resolve(value instanceof URL ? fileURLToPath(value) : value);
  const publicRoot = resolve(root, 'public');
  if (within(target, publicRoot) || within(publicRoot, target)) throw new TypeError('Catalogue previews require a dedicated private directory.');
  return target;
}

export function runCatalogueProcess(command, args, { cwd, env, signal, timeoutMs = 300000 }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'ignore', windowsHide: true, signal });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Catalogue render timed out.')); }, timeoutMs);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Catalogue rendering is unavailable.')); });
    child.once('exit', code => { clearTimeout(timer); if (code === 0) resolveRun(); else reject(new Error('Catalogue rendering failed.')); });
  });
}

export function createCatalogueRenderAdapter({ privateRoot, blender = process.env.BLENDER_BIN, python = process.env.PYTHON_BIN || 'python', runProcess = runCatalogueProcess } = {}) {
  const privatePath = cataloguePrivateRoot(privateRoot);
  const knownBlender = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
  const blenderBin = blender || (existsSync(knownBlender) ? knownBlender : 'blender');
  return async function render(job, { signal } = {}) {
    // Validate everything before making a directory or invoking a process.
    if (!/^render-[a-zA-Z0-9-]{1,90}$/.test(job?.id ?? '') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(job?.productId ?? '') || job.productId.length > 100) throw new Error('Invalid catalogue render job.');
    if (!['standard', 'front', 'overhead'].includes(job.renderCamera ?? 'standard')) throw new Error('Invalid catalogue studio camera.');
    const p = validateProduct({ id: job.productId, revision: 1, ...job.configuration,
      title: 'Product preview', category: 'Preview', summary: 'Preview of public settings.', status: 'published',
      images: [{ src: '/assets/images/products/catalogue/preview.webp', alt: 'Product studio preview', kind: 'render' }] });
    if (catalogueConfigurationHash({ ...p, renderCamera: job.renderCamera }) !== job.configurationSha256) throw new Error('Catalogue render settings changed.');
    const work = resolve(privatePath, job.id);
    // Child environments contain OS/runtime paths only, never database or provider credentials.
    const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'LANG'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    Object.assign(env, { PRODUCT_RENDER_WORK_DIR: work, PRODUCT_RENDER_PRIVATE_ROOT: privatePath });
    try {
      await mkdir(work, { recursive: true });
      await writeFile(resolve(work, 'input.json'), JSON.stringify({ id: job.id, productId: job.productId, configurationSha256: job.configurationSha256,
        renderCamera: job.renderCamera ?? 'standard',
        configuration: { generatorId: p.generatorId, generatorVersion: p.generatorVersion, params: p.params } }), { mode: 0o600 });
      await runProcess(process.execPath, ['--max-old-space-size=2048', resolve(root, 'scripts/build-catalogue-job-meshes.mjs')], { cwd: root, env, signal });
      await runProcess(blenderBin, ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', resolve(root, 'scripts/render-products.py')], { cwd: root, env, signal });
      await runProcess(python, [resolve(root, 'scripts/finish-catalogue-job.py')], { cwd: root, env, signal });
      const result = JSON.parse(await readFile(resolve(work, 'result.json'), 'utf8'));
      if (result.jobId !== job.id || result.configurationSha256 !== job.configurationSha256 || result.renderer !== 'Blender Cycles') throw new Error('Invalid render receipt.');
      const safe = validateProduct({ ...p, images: result.images });
      for (let index = 0; index < safe.images.length; index++) {
        const bytes = await readFile(resolve(work, `preview-${index}.webp`));
        if (bytes.length > 512 * 1024 || sha(bytes) !== result.imageSha256s[index]) throw new Error('Invalid preview bytes.');
      }
      return { ...result, images: safe.images };
    } catch { throw new Error('Catalogue previews could not be built. The private draft is preserved.'); }
  };
}
