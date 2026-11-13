import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,emptyState,serialize,hydrate,takenOut} from '../src/model.js';
import {readExcel,writeExcel} from '../src/excel.js';
import ExcelJS from 'exceljs';
function fixture(){let state=emptyState();const run=p=>{state=act(state,{...p,revision:state.revision,requestId:crypto.randomUUID()});state.revision++;return state};run({action:'box',id:'Test box',temperature:-80,contents:'Example vials'});return {get state(){return state},run,get box(){return state.boxes[0].sheet}}}
test('vial lifecycle and exact metadata retention',()=>{
  const t=fixture(),add={action:'add',sheet:t.box,mode:'single',name:'Sample 001',quantity:2,frozenOn:'2025-01-15',type:'Cell line',volume:100,volumeUnit:'µL',cells:'1E6',start:'auto'};
  t.run(add);assert.equal(t.state.boxes[0].filled,2);
  t.run({action:'edit',sheet:t.box,position:'A1',updates:{notes:'Test note',passage:0}});assert.equal(t.state.boxes[0].slots[0].detail.passage,0);
  t.run({action:'use',sheet:t.box,position:'A1',amount:50});assert.equal(t.state.boxes[0].slots[0].detail.volume,50);
  assert.throws(()=>t.run({action:'move',sheet:t.box,position:'A1',targetSheet:t.box,targetPosition:'A2'}),/occupied/);
  t.run({action:'takeout',sheet:t.box,position:'A1',disposition:'out'});const record=takenOut(t.state)[0];assert.equal(record.sample.detail.volume,50);
  t.run({action:'return',recordId:record.id,targetSheet:t.box,targetPosition:'J10',incrementThaws:true});assert.equal(t.state.boxes[0].slots[99].detail.thaws,1);assert.equal(takenOut(t.state).length,0);
  t.run({action:'undo'});assert.equal(takenOut(t.state).length,1);assert.equal(t.state.boxes[0].slots[99].occupied,false);
  assert.deepEqual(serialize(hydrate(serialize(t.state))),serialize(t.state));
});
test('Excel round trip keeps dates, zeros, positions and take-out history',async()=>{
  const t=fixture();t.run({action:'add',sheet:t.box,mode:'single',name:'=Literal sample',quantity:1,frozenOn:'2025-01-15',type:'Reagent',volume:0,volumeUnit:'µL',cells:'',start:'A1'});
  t.run({action:'edit',sheet:t.box,position:'A1',updates:{passage:0,thaws:0,concentration:1.5,concentrationUnit:'mg/mL',expiresOn:'2026-01-15',notes:'First line\nSecond line'}});
  const loaded=hydrate(await readExcel(await writeExcel(t.state)));assert.deepEqual(serialize(loaded),serialize(t.state));
  t.run({action:'takeout',sheet:t.box,position:'A1',disposition:'out'});
  const removed=hydrate(await readExcel(await writeExcel(t.state)));assert.equal(takenOut(removed).length,1);assert.equal(takenOut(removed)[0].sample.detail.volume,0);
});
test('import maps history to new boxes without overwriting an existing vial',()=>{
  const a=fixture(),b=fixture();b.run({action:'add',sheet:b.box,name:'Sample 002',mode:'single',quantity:1,type:'Other',frozenOn:'2025-01-15',start:'A1'});b.run({action:'takeout',sheet:b.box,position:'A1',disposition:'out'});
  a.run({action:'import',data:serialize(b.state)});assert.equal(a.state.boxes.length,2);const out=takenOut(a.state)[0];assert.equal(out.sheet,a.state.boxes[1].sheet);assert.notEqual(out.id,takenOut(b.state)[0].id);
});
test('stale requests, overdraw and duplicate positions are rejected',()=>{const t=fixture();assert.throws(()=>act(t.state,{action:'box',revision:-1}),/changed/);const bad=serialize(t.state);bad.boxes[0].slots=[{position:'Z1',label:'No'}];assert.throws(()=>hydrate(bad),/position/)});
test('undo reverses a whole daily-note save, including a reused position and its archive',async()=>{
  const t=fixture(),add=name=>({action:'add',sheet:t.box,mode:'single',name,quantity:1,type:'Reagent',frozenOn:'2025-01-15',start:'A1'});
  t.run(add('Original sample'));const before=serialize(t.state).boxes;
  const requestId=crypto.randomUUID(),actions=[{action:'takeout',sheet:t.box,position:'A1',disposition:'out'},add('Replacement sample'),{...add('Another sample'),start:'A2'}];
  t.run({action:'batch',actions,requestId});assert.equal(t.state.boxes[0].filled,2);assert.equal(takenOut(t.state).length,1);
  t.run({action:'undo'});assert.deepEqual(serialize(t.state).boxes,before);assert.equal(takenOut(t.state).length,0);assert.equal(t.state.events.at(-1).undoOfs.length,3);
  const reloaded=hydrate(await readExcel(await writeExcel(t.state)));assert.equal(takenOut(reloaded).length,0);
  const other=fixture();other.run({action:'import',data:serialize(t.state)});assert.equal(takenOut(other.state).length,0);const importedBatch=other.state.events.find(e=>e.batchId);assert.notEqual(importedBatch.batchId,t.state.events.find(e=>e.batchId).batchId);
});
test('editing or copying imported long notes preserves them and long labels survive reload',()=>{
  const t=fixture(),data=serialize(t.state),notes='Detailed original annotation. '.repeat(150),label='Sample '+ 'x'.repeat(700);
  data.boxes[0].slots=[{position:'A1',label,detail:{notes,volume:100,volumeUnit:'µL'}}];
  t.run({action:'import',data});const imported=t.state.boxes[1].sheet;
  t.run({action:'use',sheet:imported,position:'A1',amount:5});assert.equal(t.state.boxes[1].slots[0].detail.notes,notes);
  t.run({action:'copy',sheet:imported,position:'A1',targetSheet:imported,targetPosition:'A2',quantity:1});assert.equal(t.state.boxes[1].slots[1].detail.notes,notes);
  t.run({action:'edit',sheet:imported,position:'A1',updates:{name:'x'.repeat(5000),source:'Supplier',notes:'y'.repeat(20000)}});
  assert.deepEqual(serialize(hydrate(serialize(t.state))),serialize(t.state));
});
async function editedExcel(state,edit){const wb=new ExcelJS.Workbook();await wb.xlsx.load(await writeExcel(state));edit(wb);return wb.xlsx.writeBuffer()}
test('Excel import accepts unambiguous label edits and sorted detail rows',async()=>{
  const t=fixture();t.run({action:'add',sheet:t.box,mode:'single',name:'Sample 001',quantity:2,type:'Reagent',frozenOn:'2025-01-15',start:'A1'});
  const loaded=hydrate(await readExcel(await editedExcel(t.state,wb=>{const s=wb.getWorksheet('-80 Box 01');s.getCell('B30').value='Edited in table';s.getCell('H30').value=42;const a=s.getRow(30).values.slice(),b=s.getRow(31).values.slice();s.getRow(30).values=b;s.getRow(31).values=a})));
  assert.equal(loaded.boxes[0].slots[0].label,'Edited in table');assert.equal(loaded.boxes[0].slots[0].detail.volume,42);assert.match(loaded.boxes[0].slots[1].label,/Sample 001/);
  const grid=hydrate(await readExcel(await editedExcel(t.state,wb=>{wb.getWorksheet('-80 Box 01').getCell('B13').value='Edited on grid'})));assert.equal(grid.boxes[0].slots[0].label,'Edited on grid');
  const matched=hydrate(await readExcel(await editedExcel(t.state,wb=>{wb.getWorksheet('-80 Box 01').getCell('B13').value='Matching edit';wb.getWorksheet('Sample log').getCell('D2').value='Matching edit'})));assert.equal(matched.boxes[0].slots[0].label,'Matching edit');
});
test('Excel import refuses to silently discard edited logs, missing boxes or conflicting labels',async()=>{
  const t=fixture();t.run({action:'add',sheet:t.box,mode:'single',name:'Sample 001',quantity:1,type:'Reagent',frozenOn:'2025-01-15',start:'A1'});
  await assert.rejects(readExcel(await editedExcel(t.state,wb=>{wb.getWorksheet('Sample log').getCell('D2').value='Changed log name'})),/Sample log has edits/);
  await assert.rejects(readExcel(await editedExcel(t.state,wb=>{wb.removeWorksheet('-80 Box 01')})),/deleted or renamed/);
  await assert.rejects(readExcel(await editedExcel(t.state,wb=>{const s=wb.getWorksheet('-80 Box 01');s.getCell('B13').value='Grid change';s.getCell('B30').value='Different table change'})),/conflicting edits/);
  await assert.rejects(readExcel(await editedExcel(t.state,wb=>{wb.getWorksheet('-80 Box 01').getCell('A31').value='A1'})),/duplicate position/);
  await assert.rejects(readExcel(await editedExcel(t.state,wb=>{wb.getWorksheet('-80 Box 01').getCell('N4').value=9})),/dimensions or numbering/);
  await assert.rejects(readExcel(await editedExcel(t.state,wb=>{wb.getWorksheet('-80 Box 01').getCell('B13').value={formula:'"Sample"'}})),/no saved result/);
});
test('an empty exported workbook can be reopened',async()=>{assert.deepEqual(await readExcel(await writeExcel(emptyState())),serialize(emptyState()))});
