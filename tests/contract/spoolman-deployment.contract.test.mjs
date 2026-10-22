import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('optional Spoolman connection gives only jobs application-network access',async()=>{
  const source=await readFile(new URL('../../deploy/platform/compose.spoolman.yml',import.meta.url),'utf8');
  assert.match(source,/jobs:/);assert.match(source,/networks: \[database, egress, spoolman\]/);assert.match(source,/external: true/);
  assert.doesNotMatch(source,/ports:|spoolman-private|api:|postgres:/);
  const worker=await readFile(new URL('../../scripts/platform-jobs.mjs',import.meta.url),'utf8');assert.match(worker,/createSpoolmanScheduledTask/);
  const api=await readFile(new URL('../../api/operator-print.js',import.meta.url),'utf8');assert.doesNotMatch(api,/createSpoolmanProvider|SPOOLMAN_BASE_URL/);
});
