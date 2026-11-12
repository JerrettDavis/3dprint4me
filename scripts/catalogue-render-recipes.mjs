import { createHash } from 'node:crypto';
import { validateProduct } from '../public/assets/js/catalogue/contract.js';

const camera = {
  'vase': 22, 'pumpkin': 22, 'infinity-fidget': 35, 'gridfinity-bin': 40,
  'gridfinity-base': 48, 'name-plate': 48, 'wifi-tag': 55, 'rating-card': 55,
  'route-shield': 55, 'display-sign': 30,
};

export function catalogueRenderRecipes(products, { camera: preset = 'standard' } = {}) {
  if (!['standard', 'front', 'overhead'].includes(preset)) throw new TypeError('Use an approved studio camera preset.');
  return products.map(p => validateProduct(p)).filter(p => p.status === 'published').flatMap(p => p.images.map((image, index) => ({
    id: `catalogue-${p.id}-r${p.revision}${index ? '-detail' : ''}`, generator: p.generatorId, params: p.params,
    elevation: preset === 'front' ? (index ? 35 : 10) : preset === 'overhead' ? (index ? 55 : 80) : Math.min(80, (camera[p.generatorId] ?? 35) + (index ? 25 : 0)), azimuth: index ? -90 : -65,
    output: image.src.replace('/assets/images/products/', '').split('?')[0],
    configurationSha256: createHash('sha256').update(JSON.stringify({ generatorId: p.generatorId, generatorVersion: p.generatorVersion, params: p.params,
      ...(preset !== 'standard' ? { renderCamera: preset } : {}) })).digest('hex'),
  })));
}
