import test from 'node:test';
import assert from 'node:assert/strict';
import {saveNoteDraft,readNoteDraft,clearNoteDraft} from '../src/note-drafts.js';
const memory=()=>{const m=new Map();return {setItem:(k,v)=>m.set(k,v),getItem:k=>m.get(k)??null,removeItem:k=>m.delete(k)}};
test('edited interpretations survive reload separately for each workbook, without a reviewed plan',()=>{
  const storage=memory();
  const rows=[{action:'add',sheet:'box-1',name:'Sample 001',volume:0.5,frozenOn:'2026-11-01',positions:'B2, B3',issues:{notes:'Review wording'},unrecognized:['special note']}];
  saveNoteDraft(storage,'first',{text:'Froze two vials today',box:'box-1',rows,prepared:{unsafe:true}});
  saveNoteDraft(storage,'second',{text:'Another workbook',rows:[]});
  let restored=readNoteDraft(storage,'first');
  assert.equal(restored.rows[0].volume,0.5);assert.equal(restored.rows[0].frozenOn,'2026-11-01');
  assert.equal(restored.rows[0].positions,'B2, B3');assert.deepEqual(restored.rows[0].errors,['Review wording']);
  assert.equal(restored.prepared,undefined);assert.equal(readNoteDraft(storage,'second').text,'Another workbook');
  delete restored.rows[0].issues.notes;saveNoteDraft(storage,'first',restored);
  assert.deepEqual(readNoteDraft(storage,'first').rows[0].errors,[]);
});
test('discard removes current and legacy drafts; malformed storage falls back to raw note',()=>{
  const storage=memory();storage.setItem('freezer-note-book','original note');
  storage.setItem('freezer-note-state-book','broken JSON');assert.equal(readNoteDraft(storage,'book').text,'original note');
  clearNoteDraft(storage,'book');assert.deepEqual(readNoteDraft(storage,'book'),{text:'',box:'',rows:[]});
});
