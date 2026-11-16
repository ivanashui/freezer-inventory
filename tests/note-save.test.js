import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {parseNotes} from '../src/note-parser.js';
import {act,emptyState,makeBox,serialize,hydrate} from '../src/model.js';
import {sampleInfo} from '../src/sample-info.js';
import {createStore} from '../src/store.js';

test('edited daily-note fields survive review, browser save, and reopening the workbook',async()=>{
  const options={factory:new IDBFactory(),databaseName:'daily-note-save'};
  const inventory=emptyState();
  inventory.boxes=[makeBox({id:'Box 1'}),makeBox({id:'Box 3'})];
  const store=await createStore(options);
  let reopened;
  try{
    const state=await store.create('Test inventory',serialize(inventory));
    const rows=parseNotes('froze 3 vials of Sample 006 GFP today in BOX3 A1-A3',state,{sheet:state.boxes[0].sheet,today:'2026-11-16'});
    assert.equal(rows.length,1);
    assert.deepEqual(rows[0].errors,[]);
    assert.equal(rows[0].sheet,state.boxes[1].sheet);
    assert.equal(rows[0].positions,'A1, A2, A3');

    // Form controls supply strings, including scientific notation in the cell count.
    Object.assign(rows[0],{cells:'10E6',volume:'1',volumeUnit:'mL',source:'Supplier'});
    const payload={action:'batch',revision:state.revision,requestId:crypto.randomUUID(),actions:rows.map(row=>({...row,mode:'single',note:'Daily note: '+row.raw}))};
    const before=serialize(state),review=act(state,payload);
    assert.deepEqual(review.events.at(-1).positions,['A1','A2','A3']);
    assert.deepEqual(serialize(state),before,'review must not change the open inventory');
    assert.deepEqual(serialize(await store.load()),before,'review must not write to browser storage');

    const saved=await store.save(state,payload);
    assert.equal(saved.revision,state.revision+1);
    assert.equal(saved.boxes[0].filled,0);
    assert.equal(saved.boxes[1].filled,3);
    const hydrated=hydrate(serialize(saved),saved.revision);
    assert.deepEqual(serialize(hydrated),serialize(saved));
    store.close();

    reopened=await createStore(options);
    const restored=await reopened.load();
    assert.equal(restored.workbookId,state.workbookId);
    assert.deepEqual(serialize(restored),serialize(saved));
    for(const position of ['A1','A2','A3']){
      const slot=restored.boxes[1].slots.find(vial=>vial.position===position),record=sampleInfo(slot);
      assert.equal(slot.occupied,true);
      assert.equal(record.name,'Sample 006 GFP');
      assert.equal(record.cells,'10E6');
      assert.equal(record.volume,1);
      assert.equal(record.volumeUnit,'mL');
      assert.equal(record.source,'Supplier');
      assert.equal(record.frozenOn,'2026-11-16');
    }
    assert.equal(restored.events.length,1);
    assert.equal(restored.events[0].batchId,payload.requestId);
  }finally{
    store.close();
    reopened?.close();
  }
});
