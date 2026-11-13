import {plan} from './planner.js';
import {emptySnapshot,sameSample,withdrawnRecords} from './operations.js';
export const positions=Array.from({length:100},(_,i)=>String.fromCharCode(65+Math.floor(i/10))+(i%10+1));
const copy=v=>structuredClone(v);
const text=(v,max=1200)=>String(v??'').trim().slice(0,max);
export function makeBox({id='Box 1',temperature=-80,contents='',location='',sheet=crypto.randomUUID(),rows=10,columns=10,numbering='alphanumeric',importNotes=''}={}){
  if(![-80,-20].includes(Number(temperature)))throw new Error('Choose −80°C or −20°C.');
  rows=Number(rows);columns=Number(columns);if(!Number.isInteger(rows)||!Number.isInteger(columns)||rows<1||columns<1||rows>16||columns>16)throw new Error('Box dimensions must be whole numbers from 1 to 16.');
  if(!['alphanumeric','numeric'].includes(numbering))throw new Error('Choose letters/numbers or numbered positions.');
  const slots=Array.from({length:rows*columns},(_,i)=>({position:numbering==='numeric'?String(i+1):String.fromCharCode(65+Math.floor(i/columns))+(i%columns+1),cell:String.fromCharCode(66+i%columns)+(13+Math.floor(i/columns)),detailRow:30+i,occupied:false,...emptySnapshot()}));
  return {sheet,id:text(id,100)||'Box',temperature:Number(temperature),contents:text(contents,300),location:text(location,300),rows,columns,numbering,importNotes:text(importNotes,30000),filled:0,slots};
}
export function emptyState(){return {version:2,revision:0,boxes:[],events:[]}}
export function hydrate(data,revision=0){
  if(!data)return emptyState();
  if(![1,2].includes(data.version)||!Array.isArray(data.boxes)||!Array.isArray(data.events)||data.boxes.length>100)throw new Error('This is not a supported inventory backup.');
  const state={version:2,revision,boxes:[],events:copy(data.events)};
  const ids=new Set();
  for(const raw of data.boxes){
    if(!raw.sheet||ids.has(raw.sheet)||!Array.isArray(raw.slots))throw new Error('Invalid or duplicate box in the backup.');ids.add(raw.sheet);
    const box=makeBox(raw),used=new Set();
    for(const sample of raw.slots){
      const slot=box.slots.find(s=>s.position===String(sample.position));
      if(!slot||used.has(String(sample.position)))throw new Error('Invalid or duplicate position in the backup.');used.add(String(sample.position));
      slot.label=String(sample.label??'').trim();
      for(const k of Object.keys(slot.detail))slot.detail[k]=sample.detail?.[k]??'';
      slot.occupied=!!slot.label||Object.values(slot.detail).some(v=>v!==''&&v!==null);
    }
    box.filled=box.slots.filter(s=>s.occupied).length;state.boxes.push(box);
  }
  return state;
}
export function serialize(state){return {version:2,boxes:state.boxes.map(b=>({sheet:b.sheet,id:b.id,temperature:b.temperature,contents:b.contents,location:b.location,rows:b.rows,columns:b.columns,numbering:b.numbering,importNotes:b.importNotes||'',slots:b.slots.filter(s=>s.occupied).map(s=>({position:s.position,label:s.label,detail:copy(s.detail)}))})),events:copy(state.events)}}
export function act(state,payload){
  if(payload.revision!==state.revision)throw new Error('Your inventory changed. Refresh and review this action.');
  if(payload.requestId&&state.events.some(e=>e.id===payload.requestId||e.batchId===payload.requestId))return copy(state);
  if(payload.action==='batch'){
    if(!Array.isArray(payload.actions)||!payload.actions.length||payload.actions.length>50)throw new Error('Prepare between 1 and 50 entries.');
    let result=copy(state);const batchId=payload.requestId||crypto.randomUUID();
    for(const [i,action] of payload.actions.entries()){
      if(!['add','takeout'].includes(action.action))throw new Error('Daily notes support freezing and taking out vials.');
      result=act(result,{...action,revision:state.revision,requestId:batchId+':'+i});
      result.events.at(-1).batchId=batchId;
    }
    return result;
  }
  const next=copy(state);let event;
  if(payload.action==='box'){
    let box=payload.sheet?next.boxes.find(b=>b.sheet===payload.sheet):null;
    const before=box?{id:box.id,temperature:box.temperature,contents:box.contents,location:box.location}:null;
    const edited=makeBox({...payload,temperature:Number(payload.temperature)});
    if(box){Object.assign(box,{id:edited.id,temperature:edited.temperature,contents:edited.contents,location:edited.location})}
    else{box=edited;next.boxes.push(box)}
    event={action:before?'box_edit':'box_add',sheet:box.sheet,boxName:box.id,positions:[],names:[box.id],beforeBox:before,afterBox:{id:box.id,temperature:box.temperature,contents:box.contents,location:box.location}};
  }else if(payload.action==='import'){
    const imported=hydrate(payload.data);
    if(next.boxes.length+imported.boxes.length>100)throw new Error('This import would exceed 100 boxes.');
    const sheets=new Map(imported.boxes.map(b=>[b.sheet,crypto.randomUUID()])),eventIds=new Map(imported.events.flatMap(e=>[e.id,e.batchId].filter(Boolean)).map(id=>[id,crypto.randomUUID()]));
    for(const box of imported.boxes){box.sheet=sheets.get(box.sheet);next.boxes.push(box)}
    function remap(v){if(Array.isArray(v))return v.map(remap);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,val])=>[k,k==='sheet'?(sheets.get(val)||val):['id','returnOf','undoOf','batchId'].includes(k)?(eventIds.get(val)||val):k==='undoOfs'?val.map(id=>eventIds.get(id)||id):remap(val)]));return v}
    next.events.push(...imported.events.map(remap));
    event={action:'import',sheet:'',positions:[],names:[`${imported.boxes.length} imported boxes`],importedSheets:imported.boxes.map(b=>b.sheet)};
  }else if(payload.action==='restore'){
    if(next.boxes.length||next.events.length)throw new Error('Restore a full backup only into an empty inventory. Use Excel import to add boxes.');
    const restored=hydrate(payload.data,state.revision);return restored;
  }else if(payload.action==='undo'){
    const previous=next.events.at(-1);
    if(!previous?.changes||previous.action==='undo')throw new Error('This change cannot be undone.');
    const undone=[previous];
    if(previous.batchId)for(let i=next.events.length-2;i>=0&&next.events[i].batchId===previous.batchId;i--)undone.push(next.events[i]);
    // Reverse the whole save, including reuse of a position by a later line.
    for(const entry of undone)for(const c of [...entry.changes].reverse()){const slot=next.boxes.find(b=>b.sheet===c.sheet)?.slots.find(s=>s.position===c.position);if(!slot||!sameSample(slot,c.after))throw new Error('The vial changed after this action. Undo is unavailable.');Object.assign(slot,copy(c.before));slot.occupied=!!slot.label||Object.values(slot.detail).some(v=>v!==''&&v!==null)}
    event={action:'undo',undoOf:previous.id,undoOfs:undone.map(e=>e.id),sheet:previous.sheet,positions:[...new Set(undone.flatMap(e=>e.positions||[]))],names:[...new Set(undone.flatMap(e=>e.names||[]))]};
  }else{
    const draft=plan(state,payload,state.events);
    for(const c of draft.changes){const slot=next.boxes.find(b=>b.sheet===c.sheet).slots.find(s=>s.position===c.position);Object.assign(slot,copy(c.after));slot.occupied=!!slot.label||Object.values(slot.detail).some(v=>v!==''&&v!==null)}
    event={...draft,slots:undefined,items:undefined,revision:undefined,source:undefined};
  }
  event.id=payload.requestId||crypto.randomUUID();event.time=new Date().toISOString();event.boxName=event.boxName||next.boxes.find(b=>b.sheet===event.sheet)?.id||'';
  next.events.push(JSON.parse(JSON.stringify(event)));for(const box of next.boxes)box.filled=box.slots.filter(s=>s.occupied).length;
  return next;
}
export function takenOut(state){return withdrawnRecords(state.events)}
export {plan};
