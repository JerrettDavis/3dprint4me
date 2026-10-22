import { HttpError } from '../../http.js';
export const emptyMatchingWork = () => ({ revision: 0, requirementsOverride: null, proposals: [], history: [] });
export const conflict = () => new HttpError(409, 'Filament data changed. Refresh and review before saving.', { code: 'filament_revision_conflict' });
export function createPostgresMatchingRepository(query) {
  return {
    async getMatchingSettings() {
      const [row] = await query`SELECT settings, revision FROM filament_matching_settings WHERE id = 1`;
      return row ? { settings: row.settings, revision: Number(row.revision) } : { revision: 0, settings: {} };
    },
    async saveMatchingSettings({ revision, settings }) {
      const rows = revision === 0
        ? await query`INSERT INTO filament_matching_settings (id, settings, revision) VALUES (1, ${JSON.stringify(settings)}::jsonb, 1) ON CONFLICT (id) DO NOTHING RETURNING settings, revision`
        : await query`UPDATE filament_matching_settings SET settings = ${JSON.stringify(settings)}::jsonb, revision = revision + 1, updated_at = now() WHERE id = 1 AND revision = ${revision} RETURNING settings, revision`;
      if (!rows.length) throw conflict();
      return { settings: rows[0].settings, revision: Number(rows[0].revision) };
    },
    async getWorkMatching(workId) {
      const [row] = await query`SELECT document, revision FROM work_filament_matching WHERE work_item_id = ${workId}`;
      return row ? { ...row.document, revision: Number(row.revision) } : emptyMatchingWork();
    },
    async saveWorkMatching({ workId, revision, document }) {
      const { revision: ignored, ...safeDocument } = document;
      const rows = revision === 0
        ? await query`INSERT INTO work_filament_matching (work_item_id, document, revision) VALUES (${workId}, ${JSON.stringify(safeDocument)}::jsonb, 1) ON CONFLICT (work_item_id) DO NOTHING RETURNING document, revision`
        : await query`UPDATE work_filament_matching SET document = ${JSON.stringify(safeDocument)}::jsonb, revision = revision + 1, updated_at = now() WHERE work_item_id = ${workId} AND revision = ${revision} RETURNING document, revision`;
      if (!rows.length) throw conflict();
      return { ...rows[0].document, revision: Number(rows[0].revision) };
    }
  };
}
