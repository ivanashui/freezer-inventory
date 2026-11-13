import ExcelJS from 'exceljs';
import {makeBox,serialize} from './model.js';
import {validDate} from './note-parser.js';
const clean=v=>String(v??'').trim();
function val(cell){const v=cell.value;if(v==null)return '';if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==='object'){if(v.richText)return v.richText.map(x=>x.text).join('');if('result' in v)return v.result??'';return v.text??''}return v}
const key=s=>clean(s).toLowerCase().replace(/[\s_.\-()/°]/g,'');
export const importFields=[['name','Sample name / ID'],['position','Position'],['box','Box name'],['temperature','Temperature'],['cells','Cells per vial'],['volume','Volume'],['volumeUnit','Volume unit'],['concentration','Concentration'],['concentrationUnit','Concentration unit'],['source','Source'],['type','Sample type'],['frozenOn','Date frozen'],['expiresOn','Expiry'],['passage','Passage'],['lot','Lot / clone'],['thaws','Thaw count'],['status','Status'],['identity','Name detail (e.g. clone)'],['notes','Keep in notes']];
function field(header){const h=key(header);if(/^(position|pos|slot|well|locationinbox)$/.test(h))return 'position';if(/^(name|sample|samplename|sampleid|cellline|parentalcellline|cells|monomerprotein|reagent|reagentname|id)$/.test(h))return 'name';if(/^(box|boxid|boxname)$/.test(h))return 'box';if(/^(temperature|temp|freezer|freezer[°]?c|temp[°]?c)$/.test(h))return 'temperature';if(/^(cellnumber|cellcount|cellspervial|numberofcells)/.test(h))return 'cells';if(/^volumeunit$/.test(h))return 'volumeUnit';if(/^vol(?:ume)?/.test(h))return 'volume';if(/^(concentrationunit|concunit)$/.test(h))return 'concentrationUnit';if(/^(concentration|conc)/.test(h))return 'concentration';if(/^(datefrozen|frozendate|freezedate|date)$/.test(h))return 'frozenOn';if(/^(expiry|expiration|expirationdate|expirydate)$/.test(h))return 'expiresOn';if(/^(source|supplier|vendor)$/.test(h))return 'source';if(/^(type|sampletype)$/.test(h))return 'type';if(/^passage/.test(h))return 'passage';if(/^(lot|lotclone|clone|lotnumber)$/.test(h))return 'lot';if(/^thaw/.test(h))return 'thaws';if(/^status$/.test(h))return 'status';if(/^(geneknockout|grna#?|construct|mutation|genotype|cloneid)$/.test(h))return 'identity';return 'notes'}
const unit=h=>clean(h).match(/\(([^)]+)\)/)?.[1]||'';
export function sheetConfig(sheet,headerRow=0){
  if(!headerRow){for(let r=1;r<=Math.min(30,sheet.rowCount);r++){const fields=sheet.getRow(r).values.slice(1).map(v=>field(typeof v==='object'?v?.text:v));if(fields.includes('position')&&fields.includes('name')){headerRow=r;break}}}
  const columns=Array.from({length:Math.min(sheet.columnCount,100)},(_,i)=>{const col=i+1,label=clean(val(sheet.getCell(headerRow||1,col)));return {column:col,label:label||'Column '+sheet.getColumn(col).letter,field:label?field(label):'notes'}}).filter(c=>c.label&&!sheet.getColumn(c.column).values.every(v=>v==null));
  const pos=columns.find(c=>c.field==='position'),positions=pos?Array.from({length:Math.max(0,sheet.rowCount-(headerRow||1))},(_,i)=>clean(val(sheet.getCell((headerRow||1)+1+i,pos.column)))).filter(Boolean):[];
  const numeric=positions.length&&positions.every(p=>/^\d+$/.test(p));let rows=10,cols=10;
  if(numeric){const max=Math.max(...positions.map(Number));if([64,81,100,144,256].includes(max))rows=cols=Math.sqrt(max);else rows=cols=Math.max(10,Math.ceil(Math.sqrt(max)))}
  else if(positions.length&&positions.every(p=>/^[A-P](?:1[0-6]|[1-9])$/i.test(p))){rows=Math.max(...positions.map(p=>p.toUpperCase().charCodeAt(0)-64));cols=Math.max(...positions.map(p=>Number(p.slice(1))));}
  const nameHeader=columns.find(c=>c.field==='name')?.label||'';
  return {sheet:sheet.name,include:!!headerRow,headerRow:headerRow||1,columns,rows,cols,numbering:numeric?'numeric':'alphanumeric',temperature:'',type:/cell\s*line/i.test(nameHeader)?'Cell line':/reagent|protein|antibody/i.test(nameHeader)?'Reagent':'Other'};
}
export async function inspectLegacy(buffer,fileName=''){
  if(buffer.byteLength>12000000)throw new Error('Choose a workbook smaller than 12 MB.');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
  const temperature=fileName.match(/(?:^|\D)[−-](80|20)(?:\D|$)/)?.[1];const configs=workbook.worksheets.filter(s=>!s.name.startsWith('_')).map(s=>{const c=sheetConfig(s);c.temperature=temperature?-Number(temperature):'';return c});
  return {workbook,configs,fileName};
}
export function convertLegacy(source,configs){
  const boxes=[],issues=[],summaries=[];let sourceRecords=0;const used=new Set(),globalBoxes=new Map();
  for(const config of configs.filter(c=>c.include)){
    const sheet=source.workbook.getWorksheet(config.sheet),mapping=config.columns,header=Number(config.headerRow),positionCol=mapping.find(c=>c.field==='position'),nameCol=mapping.find(c=>c.field==='name');
    if(!positionCol||!nameCol)throw new Error(`${sheet.name}: map a Position column and a Sample name column.`);
    for(const target of importFields.map(f=>f[0]).filter(f=>!['notes','identity'].includes(f))){if(mapping.filter(c=>c.field===target).length>1)throw new Error(`${sheet.name}: more than one column maps to ${target}. Keep one and put the other in Notes.`)}
    if(!Number.isInteger(header)||header<1||header>sheet.rowCount)throw new Error(`${sheet.name}: check the header row.`);
    const byBox=new Map();let count=0,blank=0;const annotations=[];
    function boxFor(id,temp){const k=String(temp)+'\u0000'+id;if(!byBox.has(k)){let b=globalBoxes.get(k);if(b&&(b.rows!==Number(config.rows)||b.columns!==Number(config.cols)||b.numbering!==config.numbering))throw new Error(`${id}: conflicting dimensions or position labels across sheets.`);if(!b){b=makeBox({id,temperature:temp,rows:config.rows,columns:config.cols,numbering:config.numbering,contents:'Imported inventory'});globalBoxes.set(k,b);boxes.push(b)}byBox.set(k,b)}return byBox.get(k)}
    for(let r=header+1;r<=sheet.rowCount;r++){
      const values=mapping.map(c=>({...c,value:val(sheet.getCell(r,c.column)),cell:sheet.getCell(r,c.column)}));
      for(const c of values)if(c.cell.value?.formula&&(!('result' in c.cell.value)||c.cell.value.result===undefined))throw new Error(`${sheet.name}!${c.cell.address}: formula has no saved result. Open and save the source in Excel first.`);
      const hasDetails=values.some(c=>!['position','box','temperature'].includes(c.field)&&clean(c.value));if(!hasDetails){blank++;continue}
      const get=f=>values.find(c=>c.field===f)?.value??'',rawPosition=clean(get('position')),name=clean(get('name'));
      if(!rawPosition&&!name){for(const c of values.filter(c=>clean(c.value)))annotations.push(`${sheet.name}!${c.cell.address}: ${clean(c.value)}`);continue}
      sourceRecords++;const rawTemp=get('temperature')!==''?get('temperature'):config.temperature;const tempMatch=String(rawTemp).match(/[−-](80|20)/),temp=tempMatch?-Number(tempMatch[1]):Number(rawTemp);
      if(![-80,-20].includes(temp))throw new Error(`${sheet.name}: choose a temperature or map its column.`);
      const box=boxFor(clean(get('box'))||sheet.name,temp);const position=config.numbering==='numeric'&&/^\d+$/.test(rawPosition)?String(Number(rawPosition)):rawPosition.toUpperCase();
      const slot=box.slots.find(s=>s.position===position);if(!slot)throw new Error(`${sheet.name}, row ${r}: position “${rawPosition||'missing'}” does not fit this box. Check the mapping and dimensions.`);
      const occupiedKey=box.sheet+':'+position;if(used.has(occupiedKey))throw new Error(`${sheet.name}, row ${r}: duplicate position ${position}. Resolve it in the source workbook before importing.`);used.add(occupiedKey);
      const notes=[`Imported from ${source.fileName||'workbook'} · ${sheet.name} · row ${r} · original position ${rawPosition}`],identity=values.filter(c=>c.field==='identity'&&clean(c.value)).map(c=>`${c.label}: ${clean(c.value)}`);slot.label=[name||`Unnamed sample at ${position}`,...identity].join(' · ');slot.occupied=true;slot.detail.type=clean(get('type'))||config.type;slot.detail.status=clean(get('status'))||'Recorded';if(!name)issues.push(`${sheet.name}, position ${position}: sample name missing; details retained.`);
      for(const c of values){if(c.cell.font?.strike&&clean(c.value))notes.push(`${c.label} was struck through in the source.`);if(c.cell.value?.formula&&!('result' in c.cell.value))throw new Error(`${sheet.name}!${c.cell.address}: formula has no saved result. Open and save the source in Excel first.`);if(c.cell.note){const note=typeof c.cell.note==='string'?c.cell.note:c.cell.note.texts?.map(x=>x.text).join('');if(note)notes.push(`${c.label} comment: ${note}`)}}
      for(const c of values.filter(c=>clean(c.value))){const v=c.value,f=c.field;if(['position','name','box','temperature','type','status','identity'].includes(f))continue;
        if(f==='notes'){notes.push(`${c.label}: ${clean(v)}`);continue}
        if(f==='source'){notes.push('Source: '+clean(v));continue}
        if(['volume','concentration','passage','thaws','cells'].includes(f)){
          const n=typeof v==='number'?v:/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(clean(v))?Number(v):NaN;
          if(!Number.isFinite(n)||n<0){notes.push(`${c.label}: ${clean(v)}`);issues.push(`${sheet.name}, position ${position}: “${clean(v)}” in ${c.label} kept as a note.`);continue}
          if(f==='cells'){const multiplier=/10\s*\^\s*6|million/i.test(c.label)?1e6:/10\s*\^\s*3|thousand/i.test(c.label)?1e3:1;notes.push('Cells per vial: '+n*multiplier)}else slot.detail[f]=n;
          if(f==='volume'&&!get('volumeUnit')){const u=unit(c.label);slot.detail.volumeUnit=/^[uµμ]l$/i.test(u)?'µL':/^ml$/i.test(u)?'mL':/^l$/i.test(u)?'L':'';if(!slot.detail.volumeUnit)issues.push(`${sheet.name}, position ${position}: volume unit is not specified.`)}
          if(f==='concentration'&&!get('concentrationUnit'))slot.detail.concentrationUnit=unit(c.label);
        }else if(['frozenOn','expiresOn'].includes(f)){let d=clean(v).replaceAll('.','-');if(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<2958466)d=new Date((v-(source.workbook.properties.date1904?24107:25569))*86400000).toISOString().slice(0,10);if(validDate(d))slot.detail[f]=d;else{notes.push(`${c.label}: ${clean(v)}`);issues.push(`${sheet.name}, position ${position}: date kept as a note because its format is unclear.`)}}
        else slot.detail[f]=clean(v);
      }
      if(slot.label.length>5000||notes.join('\n').length>20000)throw new Error(`${sheet.name}, position ${position}: this record is too long. Shorten its text before importing.`);
      slot.detail.notes=notes.join('\n');count++;
    }
    if(!byBox.size&&[-80,-20].includes(Number(config.temperature)))boxFor(sheet.name,Number(config.temperature));
    for(const b of byBox.values()){b.filled=b.slots.filter(s=>s.occupied).length;b.importNotes=[b.importNotes,annotations.join('\n')].filter(Boolean).join('\n')}
    if(annotations.length)issues.push(`${sheet.name}: ${annotations.length} cell(s) outside numbered records kept in box import notes.`);
    summaries.push({sheet:sheet.name,count,blank,boxes:byBox.size,rows:Number(config.rows),columns:Number(config.cols),numbering:config.numbering});
  }
  if(!boxes.length)throw new Error('Select at least one sheet with inventory records.');if(boxes.length>100)throw new Error('Import at most 100 boxes at once.');
  const stored=boxes.reduce((n,b)=>n+b.filled,0);if(stored!==sourceRecords)throw new Error('The source and imported record counts do not match.');
  const excluded=configs.filter(c=>!c.include).map(c=>c.sheet),event={id:crypto.randomUUID(),action:'import',time:new Date().toISOString(),sheet:'',positions:[],names:[`${stored} records from ${source.fileName||'existing workbook'}`],note:`Imported ${stored} occupied positions into ${boxes.length} boxes. Original numbering preserved.`,report:{summaries,issues,excluded}};
  return {data:serialize({boxes,events:[event]}),summaries,issues,excluded,count:stored};
}
