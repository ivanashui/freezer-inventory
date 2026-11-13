import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,emptyState,serialize,hydrate,takenOut} from '../src/model.js';
import {readExcel,writeExcel} from '../src/excel.js';
function fixture(){let state=emptyState();const run=p=>{state=act(state,{...p,revision:state.revision,requestId:crypto.randomUUID()});state.revision++;return state};run({action:'box',id:'Test box',temperature:-80,contents:'Example vials'});return {get state(){return state},run,get box(){return state.boxes[0].sheet}}}
test('vial lifecycle and exact metadata retention',()=>{
  const t=fixture(),add={action:'add',sheet:t.box,mode:'single',name:'Line A',quantity:2,frozenOn:'2026-11-13',type:'Cell line',volume:75,volumeUnit:'µL',cells:'5E6',start:'auto'};
  t.run(add);assert.equal(t.state.boxes[0].filled,2);
  t.run({action:'edit',sheet:t.box,position:'A1',updates:{notes:'Test note',passage:0}});assert.equal(t.state.boxes[0].slots[0].detail.passage,0);
  t.run({action:'use',sheet:t.box,position:'A1',amount:25});assert.equal(t.state.boxes[0].slots[0].detail.volume,50);
  assert.throws(()=>t.run({action:'move',sheet:t.box,position:'A1',targetSheet:t.box,targetPosition:'A2'}),/occupied/);
  t.run({action:'takeout',sheet:t.box,position:'A1',disposition:'out'});const record=takenOut(t.state)[0];assert.equal(record.sample.detail.volume,50);
  t.run({action:'return',recordId:record.id,targetSheet:t.box,targetPosition:'J10',incrementThaws:true});assert.equal(t.state.boxes[0].slots[99].detail.thaws,1);assert.equal(takenOut(t.state).length,0);
  t.run({action:'undo'});assert.equal(takenOut(t.state).length,1);assert.equal(t.state.boxes[0].slots[99].occupied,false);
  assert.deepEqual(serialize(hydrate(serialize(t.state))),serialize(t.state));
});
test('Excel round trip keeps dates, zeros, positions and take-out history',async()=>{
  const t=fixture();t.run({action:'add',sheet:t.box,mode:'single',name:'=Literal sample',quantity:1,frozenOn:'2026-11-13',type:'Reagent',volume:0,volumeUnit:'µL',cells:'',start:'A1'});
  t.run({action:'edit',sheet:t.box,position:'A1',updates:{passage:0,thaws:0,concentration:1.5,concentrationUnit:'mg/mL',expiresOn:'2027-01-01',notes:'First line\nSecond line'}});
  const loaded=hydrate(await readExcel(await writeExcel(t.state)));assert.deepEqual(serialize(loaded),serialize(t.state));
  t.run({action:'takeout',sheet:t.box,position:'A1',disposition:'out'});
  const removed=hydrate(await readExcel(await writeExcel(t.state)));assert.equal(takenOut(removed).length,1);assert.equal(takenOut(removed)[0].sample.detail.volume,0);
});
test('import maps history to new boxes without overwriting an existing vial',()=>{
  const a=fixture(),b=fixture();b.run({action:'add',sheet:b.box,name:'Vial B',mode:'single',quantity:1,type:'Other',frozenOn:'2026-11-13',start:'A1'});b.run({action:'takeout',sheet:b.box,position:'A1',disposition:'out'});
  a.run({action:'import',data:serialize(b.state)});assert.equal(a.state.boxes.length,2);const out=takenOut(a.state)[0];assert.equal(out.sheet,a.state.boxes[1].sheet);assert.notEqual(out.id,takenOut(b.state)[0].id);
});
test('stale requests, overdraw and duplicate positions are rejected',()=>{const t=fixture();assert.throws(()=>act(t.state,{action:'box',revision:-1}),/changed/);const bad=serialize(t.state);bad.boxes[0].slots=[{position:'Z1',label:'No'}];assert.throws(()=>hydrate(bad),/position/)});
