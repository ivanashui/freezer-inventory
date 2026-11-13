import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,emptyState,makeBox,serialize,takenOut} from '../src/model.js';
import {sampleInfo} from '../src/sample-info.js';
import {parseNotes,parseLabelText} from '../src/note-parser.js';
import {askInventory} from '../src/inventory-questions.js';
function fixture(){let state=emptyState();state.boxes=[makeBox({id:'Box 1',temperature:-80}),makeBox({id:'Box 1',temperature:-20})];return state}
const request=(state,action)=>({...action,revision:state.revision,requestId:crypto.randomUUID()});
function add(state,name='Sample 001',extra={}){return act(state,request(state,{action:'add',sheet:state.boxes[0].sheet,name,quantity:1,mode:'single',type:'Reagent',frozenOn:'2025-01-15',start:'auto',volume:100,volumeUnit:'µL',...extra}))}
test('copy preserves all metadata and the original while allocating only empty positions',()=>{
 let s=add(fixture(),'Sample 001',{source:'Supplier',cells:'1E6',lot:'Lot 1',passage:0,concentration:2,concentrationUnit:'mg/mL',expiresOn:'2027-01-15',thaws:0,notes:'Keep this note'});s=add(s,'Sample 002');const before=serialize(s),source=s.boxes[0].slots[0];
 const copied=act(s,request(s,{action:'copy',sheet:s.boxes[0].sheet,position:'A1',targetSheet:s.boxes[0].sheet,targetPosition:'auto',quantity:3,updates:{frozenOn:'2025-02-01',volume:20}}));
 assert.deepEqual(serialize(s),before);assert.deepEqual(copied.boxes[0].slots[0],source);assert.deepEqual(copied.events.at(-1).changes.map(c=>c.position),['A3','A4','A5']);const info=sampleInfo(copied.boxes[0].slots[2]);assert.equal(info.passage,0);assert.equal(info.thaws,0);assert.equal(info.source,'Supplier');assert.equal(info.concentration,2);assert.equal(info.expiresOn,'2027-01-15');assert.equal(info.volume,20);assert.equal(info.notes,'Keep this note');
 const undone=act(copied,request(copied,{action:'undo'}));assert.equal(undone.boxes[0].filled,2);assert.deepEqual(undone.boxes[0].slots[0],source);
 assert.throws(()=>act(s,request(s,{action:'copy',sheet:s.boxes[0].sheet,position:'A1',targetSheet:s.boxes[0].sheet,targetPosition:'A2',quantity:1})),/occupied/);
});
test('daily notes parse units and dates and reject ambiguous boxes and unknown details',()=>{
 const s=fixture(),context={sheet:s.boxes[0].sheet,today:'2025-02-01'};
 const [r]=parseNotes('Froze four vials of Sample 001, 1 million cells per vial, 100 uL each, yesterday, from Supplier',s,context);assert.equal(r.quantity,4);assert.equal(r.cells,'1000000');assert.equal(r.volumeUnit,'µL');assert.equal(r.frozenOn,'2025-01-31');assert.equal(r.source,'Supplier');assert.deepEqual(r.errors,[]);
 assert.match(parseNotes('Froze 2 vials of Sample 001, box 1',s,context)[0].errors.join(' '),/ambiguous/);
 assert.equal(parseNotes('Froze 2 vials of Sample 001, box 1, -20°C',s,context)[0].sheet,s.boxes[1].sheet);
 assert.match(parseNotes('Froze 2 vials of Sample 001, 5 mystery units',s,context)[0].errors.join(' '),/Unrecognized/);
 assert.match(parseNotes('Froze 2 vials of Sample 001 100 uL each',s,context)[0].errors.join(' '),/commas/);
 assert.match(parseNotes('Froze 2 vials of Sample 001, 2025-02-30',s,context)[0].errors.join(' '),/real date/);
});
test('batch changes are atomic and take-outs retain their full records',()=>{
 const s=add(fixture()),before=serialize(s),sheet=s.boxes[0].sheet;
 assert.throws(()=>act(s,request(s,{action:'batch',actions:[{action:'takeout',sheet,position:'A1',disposition:'out'},{action:'takeout',sheet,position:'J10',disposition:'out'}]})),/empty/);assert.deepEqual(serialize(s),before);
 const done=act(s,request(s,{action:'batch',actions:[{action:'takeout',sheet,position:'A1',disposition:'out'},{action:'add',sheet,name:'Sample 002',quantity:2,type:'Other',frozenOn:'2025-02-01',start:'auto'}]}));assert.equal(takenOut(done).length,1);assert.equal(takenOut(done)[0].sample.detail.volume,100);assert.equal(done.boxes[0].filled,2);
});
test('ambiguous sample take-out requires selecting a specific vial',()=>{
 const s=add(fixture(),'Sample 001',{quantity:2});const [r]=parseNotes('Took out Sample 001',s,{sheet:s.boxes[0].sheet});assert.equal(r.position,'');assert.match(r.needsPosition,/Several/);
});
test('inventory answers use stored evidence, exact positions, dates and stock grouping',()=>{
 let s=add(fixture(),'Sample 001',{quantity:2,source:'Supplier',lot:'Lot 1'});s=add(s,'Sample 002',{frozenOn:'2024-01-15',expiresOn:'2025-02-15',lot:'Lot 2'});s=add(s,'Reagent 001');
 assert.equal(askInventory(s,'Where is Sample 001?').records.length,2);assert.equal(askInventory(s,'How many vials of Sample 001?').records.length,2);
 assert.equal(askInventory(s,'Show oldest vials').records[0].name,'Sample 002');assert.equal(askInventory(s,'Free space').boxes.reduce((n,b)=>n+b.free,0),196);
 assert.equal(askInventory(s,'Expiring in 30 days',{today:'2025-02-01'}).records.length,1);assert.equal(askInventory(s,'What is running low?',{lowLimit:1}).groups.length,2);
 assert.equal(askInventory(s,'Expiring Sample 001 in 30 days',{today:'2025-02-01'}).records.length,0);assert.equal(askInventory(s,'Running low Sample 002').groups.length,1);assert.equal(askInventory(s,'Find vials from Supplier').records.length,2);
 assert.equal(askInventory(s,'Where is A3?').records[0].name,'Sample 002');assert.equal(askInventory(s,'Where is missing sample?').records.length,0);
});
test('label transcription keeps raw text and does not invent a freeze date',()=>{
 const text='Sample 001\n100 uL\n1E6 cells\nSource: Supplier\nP0';const row=parseLabelText(text,{sheet:'example'});assert.equal(row.name,'Sample 001');assert.equal(row.volume,100);assert.equal(row.cells,'1000000');assert.equal(row.passage,0);assert.equal(row.frozenOn,'');assert.match(row.notes,/Source: Supplier/);
 assert.equal(parseLabelText(text+'\n2025.01.15').frozenOn,'2025-01-15');
});
