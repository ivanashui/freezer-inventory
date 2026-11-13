import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createStore} from '../src/store.js';
const options=()=>({factory:new IDBFactory(),databaseName:'test'});
test('saved workbooks survive a fresh store instance and stay separate',async()=>{
  const opts=options(),store=await createStore(opts);let a=await store.load();
  a=await store.save(a,{action:'box',id:'Research box',temperature:-80,revision:a.revision,requestId:crypto.randomUUID()});
  const b=await store.create('Second workbook');assert.equal(b.boxes.length,0);
  await store.select(a.workbookId);store.close();
  const reopened=await createStore(opts),restored=await reopened.load();assert.equal(restored.workbookId,a.workbookId);assert.equal(restored.boxes[0].id,'Research box');assert.equal((await reopened.list()).length,2);reopened.close();
});
test('a stale tab cannot overwrite a saved change; retry is idempotent',async()=>{
  const opts=options(),one=await createStore(opts),initial=await one.load(),two=await createStore(opts),stale=await two.load();
  const payload={action:'box',id:'First change',temperature:-80,revision:initial.revision,requestId:crypto.randomUUID()};
  const saved=await one.save(initial,payload);const again=await one.save(initial,payload);assert.equal(saved.revision,again.revision);assert.equal(again.boxes.length,1);
  await assert.rejects(two.save(stale,{...payload,id:'Stale change',requestId:crypto.randomUUID()}),/another tab/);
  assert.equal((await two.load()).boxes[0].id,'First change');one.close();two.close();
});
test('a delayed batch retry after another save does not duplicate or roll back entries',async()=>{
  const store=await createStore(options());let state=await store.load();state=await store.save(state,{action:'box',id:'Box 1',temperature:-80,revision:state.revision,requestId:crypto.randomUUID()});const original=state;
  const payload={action:'batch',revision:state.revision,requestId:crypto.randomUUID(),actions:[{action:'add',sheet:state.boxes[0].sheet,mode:'single',name:'Sample 001',quantity:1,type:'Reagent',frozenOn:'2025-01-15',start:'A1'}]};
  state=await store.save(state,payload);state=await store.save(state,{action:'edit',sheet:state.boxes[0].sheet,position:'A1',updates:{notes:'Saved later'},revision:state.revision,requestId:crypto.randomUUID()});
  const retried=await store.save(original,payload);assert.equal(retried.revision,state.revision);assert.equal(retried.boxes[0].filled,1);assert.equal(retried.boxes[0].slots[0].detail.notes,'Saved later');store.close();
});
test('requests without IDs still save and invalid actions leave storage intact',async()=>{
  const store=await createStore(options());let state=await store.load();state=await store.save(state,{action:'box',id:'Box 1',temperature:-80,revision:state.revision});state=await store.save(state,{action:'box',id:'Box 2',temperature:-20,revision:state.revision});assert.equal(state.boxes.length,2);
  await assert.rejects(store.save(state,{action:'takeout',sheet:state.boxes[0].sheet,position:'A1',revision:state.revision,requestId:crypto.randomUUID()}),/empty/);assert.equal((await store.load()).revision,state.revision);store.close();
});
