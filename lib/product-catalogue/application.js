import { createHash } from 'node:crypto';
import { HttpError } from '../http.js';
import { assertCatalogueOwner, createCatalogueDraft, editCatalogueDraft, queueCatalogueRender, approveCatalogueDraft } from './domain.js';
import { getGenerator } from '../../public/assets/js/customize/registry.js';
import { cataloguePreviewHref } from '../../public/assets/js/catalogue/contract.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const bad = () => { throw new HttpError(400, 'A valid catalogue command is required.'); };
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function validateCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) bad();
  const extra = { promote: ['workId'], save: ['revision', 'edit'], render: ['revision'], approve: ['revision'] }[command.action];
  if (!extra || Object.keys(command).some(key => !['action', 'id', 'commandId', ...extra].includes(key))) bad();
  if (typeof command.id !== 'string' || !ID.test(command.id) || command.id.length > 100) bad();
  if (typeof command.commandId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(command.commandId)) bad();
  if (command.action === 'promote') {
    if (typeof command.workId !== 'string' || !/^work_[A-Za-z0-9_-]{8,123}$/.test(command.workId)) bad();
  } else if (!Number.isSafeInteger(command.revision) || command.revision < 1) bad();
}

export function createCatalogueApplication({ repository, workRepository, renderConfigured = false, publishConfigured = false, publicSiteUrl = process.env.SITE_URL || 'https://3dprint4.me', now = () => new Date().toISOString() }) {
  return {
    async list(actor) { assertCatalogueOwner(actor); return { renderConfigured, publishConfigured, products: (await repository.list()).map(r => r.draft) }; },
    async get(id, actor) {
      assertCatalogueOwner(actor);
      if (typeof id !== 'string' || !ID.test(id) || id.length > 100) bad();
      const result = await repository.get(id);
      if (!result) throw new HttpError(404, 'This catalogue product was not found.');
      const generator = getGenerator(result.draft.generatorId);
      const fields = Object.entries(generator?.schema ?? {}).filter(([, field]) => !field.sensitive).map(([key, field]) => ({
        key, type: field.type, label: field.label ?? key,
        ...Object.fromEntries(['min', 'max', 'step', 'unit', 'help', 'options'].filter(name => field[name] !== undefined).map(name => [name, field[name]])),
      }));
      let previewUrl = null;
      try {
        const site = new URL(publicSiteUrl);
        if (site.username || site.password || !(site.protocol === 'https:' || (site.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname)))) throw new Error();
        previewUrl = new URL(cataloguePreviewHref({ generatorId: result.draft.generatorId, generatorVersion: result.draft.generatorVersion, params: result.draft.params }), site.origin).href;
      } catch { /* Incompatible generator/site configuration must not break private draft recovery. */ }
      return { renderConfigured, publishConfigured, product: result.draft, sourceWorkId: result.sourceWorkId, fields, previewUrl };
    },
    async execute(command, actor) {
      assertCatalogueOwner(actor); validateCommand(command);
      const fingerprint = hash(JSON.stringify(canonical(command)));
      return repository.command({ id: command.id, commandId: command.commandId, fingerprint,
        revision: command.action === 'promote' ? 0 : command.revision,
        apply: async record => {
          const at = now();
          if (command.action === 'promote') {
            const work = await workRepository.getWork(command.workId, actor);
            return { draft: createCatalogueDraft({ id: command.id, customization: work?.request?.customization, actor, now: at }), sourceWorkId: command.workId };
          }
          const draft = record.draft;
          if (command.action === 'save') return { draft: editCatalogueDraft(draft, command.edit, { actor, now: at }) };
          if (command.action === 'approve') return { draft: approveCatalogueDraft(draft, { actor, now: at }) };
          if (!renderConfigured) throw new HttpError(409, 'The preview runner is not configured. Your catalogue draft is saved.');
          const jobId = `render-${hash(`${draft.id}:${command.commandId}`).slice(0, 32)}`;
          const rendering = queueCatalogueRender(draft, { jobId, actor, now: at });
          return { draft: rendering, job: { id: jobId, productId: draft.id, draftRevision: rendering.revision,
            kind: 'render', status: 'queued', configurationSha256: rendering.render.configurationSha256,
            configuration: { generatorId: draft.generatorId, generatorVersion: draft.generatorVersion, params: draft.params },
            attempts: 0, leaseUntil: null, errorCode: null, createdAt: at, updatedAt: at } };
        } });
    },
  };
}
