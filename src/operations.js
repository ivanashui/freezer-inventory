import {sampleInfo,present} from './sample-info.js';
function fail(message,status=400){const error=new Error(message);error.status=status;throw error}
const clean=(v,max=1200)=>{const s=String(v??'').trim();if(s.length>max)fail(`This text is too long (maximum ${max} characters).`);return s};
function number(v,label,whole=false){if(!present(v))return '';const n=Number(v);if(!Number.isFinite(n)||n<0||(whole&&!Number.isInteger(n)))fail(`${label} must be a non-negative ${whole?'whole number':'number'}.`);return n}
function date(v){const s=clean(v,10);if(!s)return '';const d=new Date(s+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(+d)||d.toISOString().slice(0,10)!==s)fail('Enter a valid date.');return s}
export function snapshot(slot){return {label:slot.label||'',detail:structuredClone(slot.detail||{})}}
export function sameSample(a,b){const x=snapshot(a),y=snapshot(b);return x.label===y.label&&[...new Set([...Object.keys(x.detail),...Object.keys(y.detail)])].every(k=>(x.detail[k]??'')===(y.detail[k]??''))}
export function emptySnapshot(){return {label:'',detail:Object.fromEntries(['type','lot','passage','concentration','concentrationUnit','volume','volumeUnit','frozenOn','expiresOn','thaws','status','notes'].map(k=>[k,'']))}}
export function withdrawnRecords(events){
  const undone=new Set(events.filter(e=>e.action==='undo').flatMap(e=>e.undoOfs||[e.undoOf]).filter(Boolean));
  const active=events.filter(e=>!undone.has(e.id));
  const returned=new Set(active.filter(e=>e.action==='return').map(e=>e.returnOf));
  return active.filter(e=>e.action==='takeout'&&e.sample&&!returned.has(e.id)).map(e=>({id:e.id,sheet:e.sheet,position:e.positions[0],sample:e.sample,name:sampleInfo(e.sample).name,time:e.time,date:e.operationDate||e.time.slice(0,10),disposition:e.disposition,note:e.note,canReturn:e.disposition==='out'}));
}
export function editSnapshot(slot,updates){
  const old={...sampleInfo(slot),status:slot.detail?.status||''},info={...old,...updates};
  for(const k of ['name','source','cells','lot','notes','type','status','volumeUnit','concentrationUnit'])if(String(info[k]??'')!==String(old[k]??''))info[k]=clean(info[k],k==='name'?5000:k==='notes'?20000:300);
  if(!info.name)fail('Enter a sample name or ID.');
  if(/\d\s*(?:u|µ|μ|m)?l\b/i.test(info.cells))fail('Enter liquid amounts under Volume per vial.');
  for(const k of ['frozenOn','expiresOn'])info[k]=date(info[k]);
  for(const [k,title,whole] of [['volume','Volume',false],['passage','Passage',true],['concentration','Concentration',false],['thaws','Thaw count',true]])info[k]=number(info[k],title,whole);
  if(present(info.volume)&&!['µL','mL','L','Other'].includes(info.volumeUnit))fail('Choose the volume unit.');
  const labelKeys=['name','source','cells','frozenOn','volume','volumeUnit'];
  const labelChanged=labelKeys.some(k=>String(info[k]??'')!==String(old[k]??''));
  const label=labelChanged?[info.name,info.source?`from ${info.source}`:'',[info.frozenOn.replaceAll('-','.'),info.cells?info.cells+' cells':''].filter(Boolean).join(' '),present(info.volume)?`${info.volume} ${info.volumeUnit}`:'',slot.label?.split('\n').find(l=>/^\d+\/\d+$/.test(l))||''].filter(Boolean).join('\n'):slot.label;
  const detail={...slot.detail};
  for(const k of ['type','lot','passage','concentration','concentrationUnit','volume','volumeUnit','frozenOn','expiresOn','thaws','status'])detail[k]=info[k];
  if(['source','cells','notes'].some(k=>String(info[k]??'')!==String(old[k]??'')))detail.notes=[info.source?'Source: '+info.source:'',info.cells?'Cells per vial: '+info.cells:'',info.notes].filter(Boolean).join('\n');
  return {label,detail};
}
export function planOperation(state,payload,events=[]){
  const action=payload.action==='remove'?'takeout':payload.action;
  if(!['edit','takeout','move','return','use','copy'].includes(action))fail('Choose a supported inventory action.');
  if(payload.revision!==state.revision)fail('The workbook changed. Refresh the sample and review your change again.',409);
  const changes=[];
  function locate(sheet,position,occupied){
    const box=state.boxes.find(b=>b.sheet===sheet);if(!box)fail('Choose a freezer box.');
    const slot=box.slots.find(s=>s.position===position);if(!slot)fail('Choose a position shown in this box.');
    if(slot.pendingId)fail('This position already has a pending change. Wait for it to sync or cancel that change.');
    if(occupied&&!slot.occupied)fail('This position is now empty.');
    if(!occupied&&slot.occupied)fail(`${box.id}, ${slot.position} is occupied. Choose an empty position.`);
    return {box,slot};
  }
  function change(box,slot,after){changes.push({sheet:box.sheet,position:slot.position,cell:slot.cell,detailRow:slot.detailRow,before:snapshot(slot),after})}
  let source,record;
  if(action==='return'){
    record=withdrawnRecords(events).find(r=>r.id===payload.recordId);
    if(!record||!record.canReturn)fail('This vial is not available to return. It may already have been returned.');
    source=record.sample;
  }else{
    const {box,slot}=locate(payload.sheet,payload.position,true);source=snapshot(slot);
    if(action==='edit')change(box,slot,editSnapshot(source,payload.updates||{}));
    if(action==='use'){
      const amount=number(payload.amount,'Amount used'),remaining=Number(source.detail.volume);
      if(!present(source.detail.volume)||!source.detail.volumeUnit)fail('Record a volume and its unit before logging partial use.');
      if(!present(amount)||amount<=0)fail('Enter an amount greater than zero.');
      if(amount>=remaining)fail(amount===remaining?'For a whole vial, choose Take out and mark it Used up.':'Amount used exceeds the recorded volume.');
      change(box,slot,editSnapshot(source,{volume:Number((remaining-amount).toPrecision(12))}));
    }
    if(action==='takeout'||action==='move')change(box,slot,emptySnapshot());
  }
  if(action==='move'||action==='return'){
    const destBox=state.boxes.find(b=>b.sheet===payload.targetSheet);if(!destBox)fail('Choose a destination box.');
    const position=payload.targetPosition==='auto'?destBox.slots.find(s=>!s.occupied&&!s.pendingId)?.position:payload.targetPosition;
    if(!position)fail('The destination box is full.');
    if(action==='move'&&payload.sheet===payload.targetSheet&&payload.position===position)fail('Choose a different destination.');
    const {box,slot}=locate(payload.targetSheet,position,false);
    const returned=structuredClone(source);
    if(action==='return'&&payload.incrementThaws===true)returned.detail.thaws=Number(returned.detail.thaws||0)+1;
    change(box,slot,returned);
  }
  if(action==='copy'){
    const box=state.boxes.find(b=>b.sheet===payload.targetSheet);if(!box)fail('Choose a destination box.');
    const quantity=Number(payload.quantity);if(!Number.isInteger(quantity)||quantity<1||quantity>100)fail('Choose 1 to 100 copies.');
    const start=payload.targetPosition==='auto'?0:box.slots.findIndex(s=>s.position===payload.targetPosition);
    if(start<0)fail('Choose a starting position.');
    if(payload.targetPosition!=='auto'&&box.slots[start].occupied)fail('The starting position is occupied.');
    const slots=box.slots.slice(start).filter(s=>!s.occupied&&!s.pendingId).slice(0,quantity);
    if(slots.length<quantity)fail(`Only ${slots.length} empty positions are available from this starting point.`);
    const cleanSource=structuredClone(source);cleanSource.label=cleanSource.label.split('\n').filter(l=>!/^\d+\/\d+$/.test(l)).join('\n');
    const copied=editSnapshot(cleanSource,payload.updates||{});
    for(const [i,slot] of slots.entries()){const after=structuredClone(copied);if(quantity>1)after.label+='\n'+(i+1)+'/'+quantity;change(box,slot,after)}
  }
  const disposition=payload.disposition||'out';
  if(action==='takeout'&&!['out','used_up','discarded','transferred'].includes(disposition))fail('Choose what happened to the vial.');
  if(changes.every(c=>sameSample(c.before,c.after)))fail('No sample details changed.');
  return {action,sheet:action==='return'?record.sheet:payload.sheet,positions:action==='return'?[record.position]:[payload.position],changes,source,sample:action==='takeout'?source:undefined,names:[sampleInfo(source).name],note:clean(payload.note),operationDate:date(payload.operationDate),disposition:action==='takeout'?disposition:undefined,returnOf:action==='return'?record.id:undefined,target:changes.length>1||['return','copy'].includes(action)?{sheet:changes.at(-1).sheet,position:changes.at(-1).position}:undefined,amount:action==='use'?Number(payload.amount):undefined};
}
