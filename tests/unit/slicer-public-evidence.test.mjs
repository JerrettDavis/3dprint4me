import test from 'node:test';
import assert from 'node:assert/strict';
import {presentPublicEstimate} from '../../lib/print-estimation/compose-estimate.js';
import {sliceStatus} from '../../lib/print-estimation/application/estimate-session.js';
import {rollUpPackProduction} from '../../lib/print-estimation/application/estimate-pack.js';

const estimate = {estimatorType:'slicer',confidence:'better',input:{options:{material:'pla',quantity:1,quality:'standard',supports:'none'},production:{gramsPerUnit:50,hoursPerUnit:2}},pricing:{range:{low:20,high:30},currency:'USD'}};
test('public slice projection explains measured totals without exposing internal provider fields', () => {
  const result = presentPublicEstimate({estimate,slicerResult:{processProfile:'Shop fine',supportPolicy:'automatic-tree',toolChanges:24,wasteGrams:12.5,supportGrams:null,secret:'private'}});
  assert.equal(result.production.slicing.toolChanges,24);
  assert.equal(result.production.slicing.wasteGrams,12.5);
  assert.equal(result.production.slicing.supportPolicy,'automatic-tree');
  assert.equal(result.production.slicing.secret,undefined);
  assert.ok(result.assumptions.includes('Automatic tree supports where needed'));
  assert.ok(!result.assumptions.includes('No supports assumed'));
});
test('missing support evidence does not repeat an unverified no-support assumption', () => {
  assert.ok(!presentPublicEstimate({estimate}).assumptions.includes('No supports assumed'));
});
test('unresolved colors expose an actionable bounded review reason', async () => {
  const status = await sliceStatus({asset:{id:'a'},options:{material:'pla'},repository:{listAssetJobs:async()=>[{jobType:'slice',profileKey:'pla:::',state:'failed',lastErrorCategory:'color_mapping_required'}]}});
  assert.equal(status.reason,'color_mapping_required');
});

test('pack production preserves per-bundle swaps and waste without adding them to total filament', () => {
  const asset = {geometryMetrics:{volumeMm3:8000,surfaceAreaMm2:2400,dimensionsMm:[20,20,20]}};
  const parts = [{asset,quantity:2,slicerProduction:{gramsPerUnit:20,hoursPerUnit:1,slicing:{processProfile:'Shop',supportPolicy:'automatic-tree',toolChanges:5,wasteGrams:8,supportGrams:null}}}];
  const result = rollUpPackProduction({parts,options:{quantity:3,material:'pla',quality:'standard',supports:'none'}});
  assert.equal(result.totalGrams,120);
  assert.equal(result.slicing.wasteGrams,16);
  assert.equal(result.slicing.toolChanges,10);
  assert.equal(result.slicing.supportGrams,null);
});
