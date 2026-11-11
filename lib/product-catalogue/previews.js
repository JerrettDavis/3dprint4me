import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { HttpError } from '../http.js';
import { cataloguePrivateRoot } from './render-adapter.js';

export async function readCataloguePreview({ privateRoot, product, index }) {
  const render = product?.render;
  if (!Number.isInteger(index) || index < 0 || index > 5 || render?.outcome !== 'ready'
    || !/^render-[A-Za-z0-9-]{1,90}$/.test(render?.jobId ?? '') || !render.images?.[index]) throw new HttpError(404, 'This private preview is not available.');
  const work = resolve(cataloguePrivateRoot(privateRoot), render.jobId);
  try {
    const receipt = JSON.parse(await readFile(resolve(work, 'result.json'), 'utf8'));
    if (receipt.jobId !== render.jobId || receipt.configurationSha256 !== render.configurationSha256 || receipt.images?.[index]?.src !== render.images[index].src) throw new Error();
    const bytes = await readFile(resolve(work, `preview-${index}.webp`));
    if (bytes.length > 512 * 1024 || createHash('sha256').update(bytes).digest('hex') !== receipt.imageSha256s?.[index]) throw new Error();
    return { mime: 'image/webp', base64: bytes.toString('base64') };
  } catch { throw new HttpError(409, 'This private preview needs to be built again. The draft is preserved.'); }
}
