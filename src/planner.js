import {snapshot,planOperation} from './operations.js';
import {parsePositions} from './positions.js';
class UserError extends Error {constructor(message,status=400){super(message);this.status=status}}
function text(v,max=300){return String(v??'').trim().slice(0,max)}
function date(v,required=false){
  const s=text(v,10);if(!s&&!required)return '';
  const d=new Date(s+'T12:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(+d)||d.toISOString().slice(0,10)!==s)throw new UserError('Enter a valid date.');
  return s;
}
function numeric(v,label,whole=false){
  if(v===''||v==null)return null; const n=Number(v);
  if(!Number.isFinite(n)||n<0||(whole&&!Number.isInteger(n)))throw new UserError(`${label} must be a non-negative ${whole?'whole number':'number'}.`);
  return n;
}
export function plan(state,payload,events=[]){
  if(payload.action&&payload.action!=='add')return planOperation(state,payload,events);
  const draft=planAdd(state,payload);
  draft.changes=draft.slots.map((slot,i)=>{
    const item=draft.items[i];
    return {sheet:draft.sheet,position:slot.position,cell:slot.cell,detailRow:slot.detailRow,before:snapshot(slot),after:{label:item.label,detail:{type:item.type,lot:item.lot||'',passage:item.passage??'',concentration:item.concentration??'',concentrationUnit:item.concentrationUnit||'',volume:item.volume??'',volumeUnit:item.volumeUnit||'',frozenOn:item.frozenOn,expiresOn:item.expiresOn||'',thaws:item.thaws??'',status:item.status||'Available',notes:[item.source?'Source: '+item.source:'',item.cells?'Cells per vial: '+item.cells:'',item.notes].filter(Boolean).join('\n')}}};
  });
  draft.names=[...new Set(draft.items.map(i=>i.name))];
  draft.note=text(payload.note,2000);
  return draft;
}
function planAdd(state,payload){
  const box=state.boxes.find(b=>b.sheet===payload.sheet);if(!box)throw new UserError('Select a freezer box.');
  if(payload.revision!==state.revision)throw new UserError('The workbook changed. Refresh the inventory, then review the positions again.',409);
  const frozenOn=date(payload.frozenOn,true);
  let entries;
  if(payload.mode==='list'){
    entries=text(payload.batch,10000).split('\n').filter(x=>x.trim()).map((line,i)=>{
      const p=line.split(/[|\t]/).map(x=>x.trim());
      if(p.length>3)throw new UserError(`Line ${i+1}: use Sample | Vials | Cells per vial.`);
      return {name:p[0],quantity:p[1]||1,cells:p[2]||''};
    });
  }else entries=[{name:payload.name,quantity:payload.quantity,cells:payload.cells}];
  if(!entries.length)throw new UserError('Enter at least one sample.');
  const type=text(payload.type)||'Other';
  if(!['Cell line','Reagent','Other'].includes(type))throw new UserError('Choose a sample type.');
  const shared={source:text(payload.source),notes:text(payload.notes,1200),lot:text(payload.lot),passage:numeric(payload.passage,'Passage',true),volume:numeric(payload.volume,'Volume'),volumeUnit:text(payload.volumeUnit,20),type,frozenOn,concentration:numeric(payload.concentration,'Concentration'),concentrationUnit:text(payload.concentrationUnit,40),expiresOn:date(payload.expiresOn),thaws:numeric(payload.thaws,'Thaw count',true),status:text(payload.status)||'Available'};
  if(shared.volume!==null&&!['µL','mL','L'].includes(shared.volumeUnit))throw new UserError('Choose a volume unit (µL, mL or L).');
  const items=[];
  for(const entry of entries){
    const name=text(entry.name,150),quantity=Number(entry.quantity),cells=text(entry.cells,80);
    if(!name)throw new UserError('Enter a sample name or ID.');
    if(!Number.isInteger(quantity)||quantity<1||quantity>100)throw new UserError('Vials must be a whole number from 1 to 100.');
    for(let i=0;i<quantity;i++){
      if(/\d\s*(?:u|µ|μ|m)?l\b/i.test(cells))throw new UserError('Use Volume per vial for liquid amounts such as 72 µL. Cells per vial is for a cell count.');
      const label=[name,shared.source?`from ${shared.source}`:'',`${frozenOn.replaceAll('-','.')} ${cells?cells+' cells':''}`.trim(),shared.volume!==null?`${shared.volume} ${shared.volumeUnit}`:'',quantity>1?`${i+1}/${quantity}`:''].filter(Boolean).join('\n');
      items.push({...shared,name,cells,label});
    }
  }
  if(items.length>box.slots.length)throw new UserError(`This box holds ${box.slots.length} vials. Split this batch across boxes.`);
  let start,slots;
  if(payload.positions&&String(payload.positions).trim()){
    const addresses=parsePositions(payload.positions,box);
    if(addresses.length!==items.length)throw new UserError(`You entered ${items.length} vials but ${addresses.length} positions. Adjust the vial count or position list.`);
    if(payload.start&&payload.start!=='auto')throw new UserError('Use either an exact position list or a starting position, not both.');
    slots=addresses.map(p=>box.slots.find(s=>s.position===p));
  }else{
  if(payload.start&&payload.start!=='auto'){
    start=box.slots.findIndex(s=>s.position===String(payload.start).toUpperCase());
    if(start<0)throw new UserError('Choose a position shown in this box.');
  }else{
    start=box.slots.findIndex((_,i)=>i+items.length<=box.slots.length&&box.slots.slice(i,i+items.length).every(s=>!s.occupied));
    if(start<0)throw new UserError(`No run of ${items.length} empty positions is available. Choose fewer vials or a different box.`);
  }
  if(start+items.length>box.slots.length)throw new UserError('This batch would run past the end of the box. Choose an earlier position.');
  slots=box.slots.slice(start,start+items.length);
  }
  const taken=slots.find(s=>s.occupied);
  if(taken)throw new UserError(`${taken.position} already contains a sample or sample details. Choose an empty position; nothing was saved.`);
  return {action:'add',sheet:box.sheet,revision:state.revision,positions:slots.map(s=>s.position),slots,items};
}
