import {test} from 'node:test';import assert from 'node:assert/strict';import ExcelJS from 'exceljs';
import {inspectLegacy,convertLegacy} from '../src/legacy-import.js';import {hydrate,serialize,act,makeBox} from '../src/model.js';import {readExcel,writeExcel} from '../src/excel.js';import {sampleInfo} from '../src/sample-info.js';
async function fixture(){const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('Box 1');s.getRow(2).values=[null,'Position','Cell line','Cell number (*10^6)','Volume (ul)','Concentration (mg/ml)','Gene knockout','gRNA #'];for(let i=1;i<=81;i++)s.getCell(i+2,2).value=i;s.getRow(3).values=[null,1,'Sample 001',5,0,0,'Gene A',1];s.getRow(12).values=[null,10,'Sample 002','?',100,'?','Gene B',2];s.getCell('I84').value='Worksheet note';return {wb,s}}
test('legacy numbered 9×9 tables retain positions, units, zeros, qualifiers and unmapped notes',async()=>{
 const {wb}=await fixture(),source=await inspectLegacy(await wb.xlsx.writeBuffer(),'-80 example.xlsx'),result=convertLegacy(source,source.configs),box=hydrate(result.data).boxes[0];
 assert.equal(box.rows,9);assert.equal(box.columns,9);assert.equal(box.numbering,'numeric');assert.equal(box.slots[9].position,'10');assert.equal(box.filled,2);assert.equal(result.count,2);
 const first=sampleInfo(box.slots[0]);assert.equal(first.cells,'5000000');assert.equal(first.volume,0);assert.equal(first.concentration,0);assert.equal(first.volumeUnit,'µL');assert.equal(first.concentrationUnit,'mg/ml');assert.match(first.name,/Gene A/);assert.match(first.name,/gRNA #: 1/);assert.equal(first.frozenOn,'');
 assert.match(sampleInfo(box.slots[9]).notes,/Concentration \(mg\/ml\): \?/);assert.match(box.importNotes,/I84: Worksheet note/);assert.equal(result.issues.length,3);
 assert.deepEqual(await readExcel(await writeExcel(hydrate(result.data))),result.data);
 const add=act(hydrate(result.data),{action:'add',revision:0,requestId:'add-numbered',sheet:box.sheet,mode:'single',name:'Sample 003',quantity:1,type:'Other',frozenOn:'2025-01-15',start:'auto'});assert.equal(add.events.at(-1).positions[0],'2');
});
test('legacy import rejects conflicting positions and preserves source contents',async()=>{
 const {wb,s}=await fixture();s.getCell('B12').value=1;const source=await inspectLegacy(await wb.xlsx.writeBuffer(),'-80 example.xlsx');assert.throws(()=>convertLegacy(source,source.configs),/duplicate position/);assert.equal(source.workbook.getWorksheet('Box 1').getCell('C12').value,'Sample 002');
});
test('old backups are loaded with their existing 10×10 coordinates',()=>{
 const old={version:1,boxes:[{sheet:'old-box',id:'Box 1',temperature:-80,contents:'',location:'',slots:[{position:'J10',label:'Sample 001',detail:{}}]}],events:[]};const state=hydrate(old);assert.equal(state.boxes[0].slots.length,100);assert.equal(state.boxes[0].slots[99].label,'Sample 001');assert.equal(serialize(state).version,2);
});
