import ExcelJS from 'exceljs';
import {makeBox,serialize,hydrate} from './model.js';
import {sampleInfo,present} from './sample-info.js';
const headers=['Position','Sample label','Type','Lot / clone','Passage','Concentration','Conc. unit','Volume','Volume unit','Date frozen','Expiry','Thaws','Status','Notes'];
const detailKeys=['type','lot','passage','concentration','concentrationUnit','volume','volumeUnit','frozenOn','expiresOn','thaws','status','notes'];
function value(cell){const v=cell.value;if(v==null)return '';if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==='object'){if(v.richText)return v.richText.map(t=>t.text).join('');if('result' in v)return v.result??'';if('text' in v)return v.text;return ''}return v}
function date(v){if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==='number')return new Date((v-25569)*86400000).toISOString().slice(0,10);return String(v||'')}
export async function readExcel(buffer){
  if(buffer.byteLength>12000000)throw new Error('Choose an Excel file smaller than 12 MB.');
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer);const boxes=[];
  const metadata=wb.getWorksheet('_Inventory data');let saved=null;
  if(metadata&&value(metadata.getCell('A1'))==='Freezer Inventory v1'){
    const count=Number(value(metadata.getCell('A2')));if(!Number.isInteger(count)||count<1||count>600)throw new Error('Invalid workbook history.');
    const json=Array.from({length:count},(_,i)=>value(metadata.getCell(i+4,1))).join('');
    saved=JSON.parse(json);hydrate(saved.state);
  }
  for(const sheet of wb.worksheets){
    const temp=Number(value(sheet.getCell('D5')));
    if(![-80,-20].includes(temp)||value(sheet.getCell('A29'))!=='Position'||String(value(sheet.getCell('A30')))!=='A1')continue;
    const box=makeBox({id:value(sheet.getCell('B5'))||sheet.name,temperature:temp,contents:value(sheet.getCell('D8')),location:[value(sheet.getCell('F5')),value(sheet.getCell('H5')),value(sheet.getCell('J5'))].filter(Boolean).join(' / ')});
    const mapped=saved?.sheets?.find(s=>s.name===sheet.name);if(mapped)box.sheet=mapped.id;
    for(const slot of box.slots){
      slot.label=String(value(sheet.getCell(slot.cell)));
      detailKeys.forEach((key,j)=>slot.detail[key]=value(sheet.getCell(slot.detailRow,j+3)));
      for(const key of ['frozenOn','expiresOn'])slot.detail[key]=date(slot.detail[key]);
      slot.occupied=!!slot.label||Object.values(slot.detail).some(v=>v!=='');
    }
    box.filled=box.slots.filter(s=>s.occupied).length;boxes.push(box);
  }
  if(!boxes.length)throw new Error('No compatible 10×10 box maps were found. Use the workbook from Freezer Quick Entry or an export from this app.');
  return serialize({boxes,events:saved?.state.events||[]});
}
const blue='233E60',light='DCEBF5',yellow='FFF6D9';
function header(row){row.height=28;row.eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:blue}};c.font={bold:true,color:{argb:'FFFFFF'},size:11};c.alignment={vertical:'middle',wrapText:true}})}
const typedDate=v=>v&&/^\d{4}-\d{2}-\d{2}$/.test(v)?new Date(v+'T12:00:00Z'):v||null;
export async function writeExcel(state){
  const wb=new ExcelJS.Workbook();wb.creator='Freezer Inventory';const sheetMap=[];
  const log=wb.addWorksheet('Sample log',{views:[{state:'frozen',ySplit:1}]});
  const logHeads=['Freezer (°C)','Box','Position','Sample','Date frozen','Volume','Unit','Cells per vial','Source','Type','Passage','Lot / clone','Concentration','Conc. unit','Expiry','Thaws','Status','Notes'];
  log.addRow(logHeads);header(log.getRow(1));
  log.columns=[12,20,10,48,16,12,10,18,32,18,12,22,16,16,16,12,20,48].map(width=>({width}));
  for(const [index,box] of state.boxes.entries()){
    const name=`${box.temperature} Box ${String(index+1).padStart(2,'0')}`,sheet=wb.addWorksheet(name,{views:[{state:'frozen',xSplit:1,ySplit:12}]});
    sheetMap.push({name,id:box.sheet});
    sheet.columns=[{width:10},...Array.from({length:10},()=>({width:21})),{width:12},{width:22},{width:48}];
    sheet.getCell('B1').value=`${box.temperature}°C · ${box.id}`;sheet.getCell('B1').font={size:18,bold:true,color:{argb:blue}};
    for(const [cell,title,val] of [['B4','Box ID',box.id],['D4','Temp (°C)',box.temperature],['F4','Location',box.location],['D7','Contents',box.contents],['H7','Filled positions',box.filled],['J7','Empty positions',100-box.filled]]){sheet.getCell(cell).value=title;sheet.getCell(cell).font={bold:true,size:11};const dest=sheet.getCell(Number(cell.slice(1))+1,cell.charCodeAt(0)-64);dest.value=val;dest.alignment={wrapText:true,vertical:'middle'}}
    sheet.mergeCells('D8:E9');sheet.getCell('B11').value='A1 is the upper-left position. Click a vial in the app to edit its full details.';
    for(let col=1;col<=10;col++)sheet.getCell(12,col+1).value=col;header(sheet.getRow(12));
    for(let r=0;r<10;r++){sheet.getCell(13+r,1).value=String.fromCharCode(65+r);sheet.getRow(13+r).height=85}
    sheet.addRow([]);headers.forEach((h,i)=>sheet.getCell(29,i+1).value=h);header(sheet.getRow(29));
    for(const slot of box.slots){
      const cell=sheet.getCell(slot.cell);cell.value=slot.label||null;cell.font={size:11};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:slot.occupied?light:yellow}};cell.alignment={wrapText:true,vertical:'middle',horizontal:'center'};cell.border={top:{style:'thin',color:{argb:'CBD6E0'}},bottom:{style:'thin',color:{argb:'CBD6E0'}},left:{style:'thin',color:{argb:'CBD6E0'}},right:{style:'thin',color:{argb:'CBD6E0'}}};
      const lines=String(slot.label).split('\n').reduce((n,l)=>n+Math.max(1,Math.ceil(l.length/20)),0);sheet.getRow(cell.row).height=Math.min(409,Math.max(sheet.getRow(cell.row).height,lines*16+16));
      sheet.getCell(slot.detailRow,1).value=slot.position;sheet.getCell(slot.detailRow,2).value=slot.label||null;
      detailKeys.forEach((key,i)=>{sheet.getCell(slot.detailRow,i+3).value=['frozenOn','expiresOn'].includes(key)?typedDate(slot.detail[key]):(slot.detail[key]===''?null:slot.detail[key])});
      sheet.getRow(slot.detailRow).alignment={wrapText:true,vertical:'top'};sheet.getRow(slot.detailRow).height=slot.occupied?Math.min(409,Math.max(48,lines*16+12)):22;
      sheet.getCell(slot.detailRow,10).numFmt='yyyy-mm-dd';sheet.getCell(slot.detailRow,11).numFmt='yyyy-mm-dd';
      if(slot.occupied){const i=sampleInfo(slot),row=log.addRow([box.temperature,box.id,slot.position,i.name,typedDate(i.frozenOn),present(i.volume)?i.volume:null,i.volumeUnit,i.cells,i.source,i.type,i.passage,i.lot,i.concentration,i.concentrationUnit,typedDate(i.expiresOn),i.thaws,i.status,i.notes]);row.alignment={wrapText:true,vertical:'top'};row.height=Math.max(45,Math.ceil(i.name.length/45)*16+14);row.getCell(5).numFmt='yyyy-mm-dd';row.getCell(15).numFmt='yyyy-mm-dd'}
    }
    sheet.autoFilter={from:'A29',to:'N129'};
  }
  log.autoFilter={from:'A1',to:`R${Math.max(1,log.rowCount)}`};
  const activity=wb.addWorksheet('Change log',{views:[{state:'frozen',ySplit:1}]});activity.columns=[24,18,22,18,18,35,55,65,65].map(width=>({width}));activity.addRow(['Saved at','Action','Box','Positions','Date of change','Disposition / target','Comment','Before','After']);header(activity.getRow(1));
  for(const e of state.events)for(const c of e.changes||[{}]){const row=activity.addRow([e.time,e.action,e.boxName||'',c.position||e.positions?.join(', ')||'',e.operationDate||'',e.disposition||e.target?.position||'',e.note||'',c.before?JSON.stringify(c.before):'',c.after?JSON.stringify(c.after):'']);row.alignment={wrapText:true,vertical:'top'};row.height=70}
  const metadata=wb.addWorksheet('_Inventory data',{state:'veryHidden'}),json=JSON.stringify({state:serialize(state),sheets:sheetMap}),chunks=json.match(/[\s\S]{1,25000}/g)||[''];
  if(chunks.length>600)throw new Error('This inventory is too large for one Excel file. Download a full JSON backup instead.');
  metadata.getCell('A1').value='Freezer Inventory v1';metadata.getCell('A2').value=chunks.length;chunks.forEach((chunk,i)=>metadata.getCell(i+4,1).value=chunk);
  return wb.xlsx.writeBuffer();
}
