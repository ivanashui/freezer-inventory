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
