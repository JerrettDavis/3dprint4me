import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpoolmanSnapshot } from '../../lib/spoolman/domain.js';
import { selectEffectiveMaterialCost, landedUsdPerKg } from '../../lib/print-estimation/inventory.js';
import { matchRequirement, DEFAULT_MATCHING_SETTINGS } from '../../lib/filament-matching/domain.js';
const now = new Date('2026-10-22T12:00:00Z');
const imported = (patch = {}) => {
  const row=normalizeSpoolmanSnapshot({instanceId:'home',currency:'USD',spools:[{id:1,archived:false,initial_weight:1000,remaining_weight:900.9,filament:{material:'PLA',color_hex:'0000ff'},...patch}]}).items[0];
  return {...row,id:'fil_imported01',freightFeeCents:0,source:{...row.source,lastSuccessAt:now.toISOString()}};
};
test('unknown costs never become zero or lower a known weighted average; fallback covers entirely unknown prices',()=>{
  const unknown=imported(),known=imported({id:2,price:20});
  assert.equal(landedUsdPerKg(unknown),null);
  const mixed=selectEffectiveMaterialCost([unknown,known],'pla',{now});
  assert.equal(mixed.landedUsdPerKg,20);assert.equal(mixed.uncoveredGrams,900);assert.equal(mixed.costCoverage,'partial');
  assert.equal(selectEffectiveMaterialCost([unknown],'pla',{now}).source,'fallback');
  assert.equal(selectEffectiveMaterialCost([{...unknown,costOverrideCents:2400}],'pla',{now}).landedUsdPerKg,24);
});
test('freshness is explicit in pricing metadata and stale imported candidates require review',()=>{
  const stale=imported({price:20});stale.source.lastSuccessAt='2026-10-22T11:55:00Z';
  const cost=selectEffectiveMaterialCost([stale],'pla',{now});assert.equal(cost.inventoryStale,true);
  const requirement={id:'blue',material:'pla',colorHex:'#0000ff',grams:100};
  assert.equal(matchRequirement(requirement,[imported()],DEFAULT_MATCHING_SETTINGS,{now}).status,'ready');
  assert.equal(matchRequirement(requirement,[stale],DEFAULT_MATCHING_SETTINGS,{now}).status,'review');
  const multi=imported();multi.source.appearanceReview=true;multi.colorHex=null;multi.color='blue';
  assert.equal(matchRequirement(requirement,[multi],DEFAULT_MATCHING_SETTINGS,{now}).candidates.length,0);
  assert.equal(matchRequirement(requirement,[imported({remaining_weight:undefined})],DEFAULT_MATCHING_SETTINGS,{now}).status,'review');
});
