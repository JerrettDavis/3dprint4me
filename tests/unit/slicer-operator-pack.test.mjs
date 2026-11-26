import test from 'node:test';
import assert from 'node:assert/strict';
import {slicerDisplayFigures} from '../../operator/assets/print-detail.js';

test('operator pack displays combined production instead of placeholder slicer fields',()=>{
  const result=slicerDisplayFigures({slicer:{pack:true},production:{gramsPerUnit:40,hoursPerUnit:2,slicing:{toolChanges:10,wasteGrams:16,processProfile:'Shop',supportPolicy:'automatic-tree'}}});
  assert.equal(result.materialGrams,40);
  assert.equal(result.elapsedSeconds,7200);
  assert.equal(result.wasteGrams,16);
  assert.equal(result.toolChanges,10);
  assert.equal(result.supportPolicy,'automatic-tree');
});
