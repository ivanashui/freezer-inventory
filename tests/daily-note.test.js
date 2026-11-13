import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseNotes,parseLabelText} from '../src/note-parser.js';
import {parsePositions} from '../src/positions.js';
import {act,emptyState,makeBox,serialize} from '../src/model.js';
const today='2026-01-15';
function fixture(){const s=emptyState();s.boxes=[makeBox({id:'Box 7'}),makeBox({id:'Box 2',numbering:'numeric',rows:9,columns:9})];return s}
function prepare(s,note){return parseNotes(note,s,{today,sheet:s.boxes[0].sheet})}
function save(s,rows){assert.deepEqual(rows.flatMap(r=>r.errors),[]);return act(s,{action:'batch',actions:rows,revision:s.revision,requestId:crypto.randomUUID()})}
test('natural note preserves the requested two positions and removes a sample descriptor',()=>{
 const s=fixture(),[r]=prepare(s,'froze 2 vials of sample Reagent-A today, box7, B2, B3');
 assert.equal(r.name,'Reagent-A');assert.equal(r.quantity,2);assert.equal(r.positions,'B2, B3');assert.equal(r.frozenOn,today);
 const saved=save(s,[r]);assert.deepEqual(saved.events.at(-1).positions,['B2','B3']);assert.equal(saved.boxes[0].slots.find(x=>x.position==='A1').occupied,false);assert.equal(saved.boxes[0].filled,2);
});
test('word order, comma-free details, ranges and count inference produce the same records',()=>{
 for(const note of ['Yesterday I froze two tubes of Sample 001 in box 7 at B2 and B3 100 uL each 1e6 cells per vial','froze Sample 001 yesterday box7 B2/B3 100 uL each 1 million cells per vial','froze 2 vials of Sample 001, 100 uL, 1e6 cells, yesterday, box7, B2–3']){
  const s=fixture(),[r]=prepare(s,note);assert.deepEqual(r.errors,[],note);assert.equal(r.name,'Sample 001');assert.equal(r.cells,'1000000');assert.equal(r.volume,100);assert.equal(r.positions,'B2, B3');assert.equal(r.quantity,2);assert.equal(r.frozenOn,'2026-01-14');save(s,[r]);
 }
});
test('explicit non-adjacent locations are never replaced with an automatic run',()=>{
 let s=fixture();s=save(s,prepare(s,'Froze 1 vial of Sample 002, box7, B3'));
 const rows=prepare(s,'Froze 2 vials of Sample 001, box7, B2, B5'),before=serialize(s),saved=save(s,rows);
 assert.deepEqual(saved.events.at(-1).positions,['B2','B5']);assert.deepEqual(serialize(s),before);assert.equal(saved.boxes[0].slots.find(x=>x.position==='B3').label.split('\n')[0],'Sample 002');
 assert.throws(()=>save(s,prepare(s,'Froze 2 vials of Sample 001, box7, B2, B3')),/already contains/);
 assert.throws(()=>save(s,prepare(s,'Froze 3 vials of Sample 001, box7, B2, B5')),/3 vials but 2 positions/);
 assert.deepEqual(serialize(s),before);
});
test('duplicate, overlapping, backwards and out-of-box positions are rejected',()=>{
 const s=fixture(),box=s.boxes[0];
 for(const value of ['B2, B2','B2-B4, B3','B5-B2','B11','Q1','B2, hello'])assert.throws(()=>parsePositions(value,box),undefined,value);
 assert.deepEqual(parsePositions('A10 to B2',box),['A10','B1','B2']);
 assert.deepEqual(parsePositions('10–12, 20',s.boxes[1]),['10','11','12','20']);
});
test('numbered inventories and multiple take-outs keep exact addresses and history',()=>{
 let s=fixture();s=save(s,prepare(s,'Froze 2 vials of Sample 001 in box2 at positions 10 and 12'));
 const rows=prepare(s,'Took out 10 and 12 from box2 yesterday');assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.position),['10','12']);assert.equal(rows[0].operationDate,'2026-01-14');
 const result=save(s,rows);assert.equal(result.boxes[1].filled,0);assert.equal(result.events.filter(e=>e.action==='takeout').length,2);
});
test('quoted names and explicit free text are not reinterpreted as metadata',()=>{
 const s=fixture(),[r]=prepare(s,'Froze 2 vials of "Sample B2, today" in box7, C2, C3, notes: moved from box 2 yesterday');
 assert.equal(r.name,'Sample B2, today');assert.equal(r.positions,'C2, C3');assert.equal(r.notes,'moved from box 2 yesterday');assert.deepEqual(r.errors,[]);
 const [source]=prepare(s,'froze 1 vial of Sample 001 from Supplier at 100 uL today in box7 at C4');assert.equal(source.source,'Supplier');assert.equal(source.volume,100);assert.equal(source.positions,'C4');
});
test('unclear text and conflicting metadata need review; no date or destination is guessed',()=>{
 const s=fixture();s.boxes.push(makeBox({id:'Box 7',temperature:-20}));
 const [r]=prepare(s,'Froze 2 vials of Sample 001, box7, B2, B3, 2026-02-30');assert.equal(r.sheet,'');assert.equal(r.frozenOn,'');assert.ok(r.issues.sheet);assert.ok(r.issues.frozenOn);
 const [extra]=prepare(s,'Froze 2 vials of Sample 001, some unclear detail');assert.deepEqual(extra.unrecognized,['some unclear detail']);assert.match(extra.notes,/some unclear detail/);assert.ok(extra.issues.notes);
 const [located]=prepare(fixture(),'Froze 1 vial of Sample 002, box7, D1, check this extra wording');assert.equal(located.positions,'D1');assert.deepEqual(located.unrecognized,['check this extra wording']);
 const [conflict]=prepare(s,'Froze 2 vials of Sample 001 100 uL each 200 uL each');assert.equal(conflict.volume,'');assert.ok(conflict.issues.volume);
});
test('fractional and scientific amounts retain the complete value',()=>{
 const s=fixture();
 for(const [note,volume,cells] of [
  ['Froze 2 vials of Sample 001, .5 mL each, .5 million cells',.5,'500000'],
  ['Froze 2 vials of Sample 001, 2e-1 mL each, 5x10^6 cells',.2,'5000000'],
  ['Froze 2 vials of Sample 001, 0 uL each, 0 cells',0,'0'],
 ]){
  const [r]=prepare(s,note);assert.deepEqual(r.errors,[],note);assert.equal(r.name,'Sample 001');assert.equal(r.volume,volume);assert.equal(r.cells,cells);const saved=save(s,[r]);assert.equal(saved.boxes[0].slots[0].detail.volume,volume);
 }
 assert.equal(parseLabelText('Sample 001\n.5 mL').volume,.5);
});
test('negative or fractional vial counts and negative amounts cannot turn into positive suffixes',()=>{
 const s=fixture();
 for(const count of ['-2','2.5','.5','-20']){const [r]=prepare(s,`Froze ${count} vials of Sample 001`);assert.equal(r.quantity,Number(count));assert.equal(r.name,'Sample 001');assert.ok(r.issues.quantity);assert.equal(r.sheet,s.boxes[0].sheet)}
 for(const amount of ['-2','-20','−.5']){const [r]=prepare(s,`Froze 2 vials of Sample 001, ${amount} uL`);assert.equal(r.volume,'');assert.ok(r.issues.volume);assert.equal(r.sheet,s.boxes[0].sheet)}
 for(const amount of ['-5e6','-20.5','-20 million','-20×10^6']){const [r]=prepare(s,`Froze 2 vials of Sample 001, ${amount} cells`);assert.equal(r.cells,'');assert.ok(r.issues.cells);assert.equal(r.sheet,s.boxes[0].sheet)}
 const [named]=prepare(s,'Froze 1 vial of Sample-20');assert.equal(named.name,'Sample-20');assert.equal(named.sheet,s.boxes[0].sheet);
});
test('total batch amounts require per-vial clarification',()=>{
 const [r]=prepare(fixture(),'Froze 2 vials of Sample 001, 100 uL total, 2 million cells in total');assert.equal(r.volume,'');assert.equal(r.cells,'');assert.match(r.issues.volume,/per vial/);assert.match(r.issues.cells,/per vial/);
});
test('a multi-vial take-out by name cannot silently remove just one match',()=>{
 let s=fixture();s=save(s,prepare(s,'Froze 1 vial of Sample 001, box7, A1'));
 const [r]=prepare(s,'Took out 2 vials of Sample 001');assert.equal(r.position,'');assert.match(r.issues.quantity,/exact positions/);
 const [single]=prepare(s,'Took out 1 vial of Sample 001');assert.equal(single.position,'A1');assert.deepEqual(single.errors,[]);
});
