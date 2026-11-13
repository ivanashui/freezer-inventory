import {test} from 'node:test';
import assert from 'node:assert/strict';
import {askInventory} from '../src/inventory-questions.js';
import {act,emptyState,makeBox} from '../src/model.js';
const today='2026-01-15';
function change(state,payload){return act(state,{...payload,revision:state.revision,requestId:crypto.randomUUID()})}
function fixture(){
 let state=emptyState();state.boxes=[makeBox({id:'Box 7'}),makeBox({id:'Reagents',temperature:-20})];
 for(const row of [{name:'Sample Low',expiresOn:'2026-01-01'},{name:'Sample 002',expiresOn:'2026-02-01'},{name:'Sample 003',expiresOn:today},{name:'Sample 004',expiresOn:''}])state=change(state,{action:'add',sheet:state.boxes[0].sheet,quantity:1,frozenOn:'2024-01-01',start:'auto',...row});
 return state;
}
const ask=(state,q,options={})=>askInventory(state,q,{today,...options});
test('expired, upcoming and exact-day expiry questions have distinct date meanings',()=>{
 const state=fixture();
 assert.deepEqual(ask(state,'Expired').records.map(r=>r.name),['Sample Low']);
 assert.deepEqual(ask(state,'Find expired vials').records.map(r=>r.name),['Sample Low']);
 assert.equal(ask(state,'Expiring in 30 days').records.length,3);
 assert.deepEqual(ask(state,'Expires today').records.map(r=>r.name),['Sample 003']);
 assert.deepEqual(ask(state,'Not expired').records.map(r=>r.name),['Sample 003','Sample 002']);
 assert.match(ask(state,'Expired').explanation,/1 matching stored vials have no valid expiry/);
 assert.throws(()=>ask(state,'Expiring in -2 days'),/0 to 3650/);
 assert.throws(()=>ask(state,'Expiring in 1.5 days'),/whole days/);
});
test('compact and numbered box filters scope counts and space instead of becoming name terms',()=>{
 const state=fixture();
 assert.equal(ask(state,'How many vials in box7?').records.length,4);
 assert.equal(ask(state,'How many vials in box 07?').records.length,4);
 assert.equal(ask(state,'Free space in box7').boxes[0].free,96);
 const named=ask(state,'Free space in Reagents');assert.equal(named.boxes.length,1);assert.equal(named.boxes[0].temperature,-20);assert.equal(named.boxes[0].free,100);
 assert.throws(()=>ask(state,'Free space in missing box'),/specify a box or freezer/);
 assert.throws(()=>ask(state,'Free space frozen before 2025-01-01'),/cannot be applied/);
});
test('sample keywords and quoted identifiers stay literal in name searches',()=>{
 let state=fixture();
 assert.deepEqual(ask(state,'Where is Sample Low?').records.map(r=>r.name),['Sample Low']);
 assert.equal(ask(state,'How many vials of Sample Low?').records.length,1);
 assert.equal(ask(state,'Find "Sample Low"').records.length,1);
 state=change(state,{action:'add',sheet:state.boxes[0].sheet,quantity:1,frozenOn:today,start:'auto',name:'A3'});
 const literal=ask(state,'Find "A3"');assert.equal(literal.records.length,1);assert.equal(literal.records[0].position,'A5');
 const address=ask(state,'Where is A3?');assert.equal(address.records[0].name,'Sample 003');
});
test('take-out date filters do not accidentally use freeze dates and ISO day 20 is not a freezer filter',()=>{
 let state=fixture();state=change(state,{action:'takeout',sheet:state.boxes[0].sheet,position:'A1',operationDate:'2026-01-12',disposition:'out'});
 assert.equal(ask(state,'Taken out before 2026-01-10').records.length,0);
 const later=ask(state,'Taken out after 2026-01-10');assert.equal(later.records.length,1);assert.match(later.explanation,/take-out date/);
 const frozen=ask(state,'Taken out frozen before 2025-01-20');assert.equal(frozen.records.length,1);assert.match(frozen.explanation,/freeze date/);
 assert.equal(ask(state,'Show vials frozen before 2025-01-20').records.length,3);
});
test('strict low-stock comparisons distinguish less than from at most',()=>{
 const state=fixture();
 assert.equal(ask(state,'Running low < 1').groups.length,0);
 assert.equal(ask(state,'Running low <= 1').groups.length,4);
 assert.throws(()=>ask(state,'Running low below 1.5'),/whole vials/);
});
