import {sampleInfo,present} from './sample-info.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const titles={add:'Added',edit:'Edited',takeout:'Taken out',remove:'Removed',move:'Moved',return:'Returned',use:'Partial use',undo:'Undid last save'};
const dispositions={out:'Taken out temporarily',used_up:'Used up',discarded:'Discarded',transferred:'Transferred'};
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const fields={name:'Sample name or ID',source:'Source',cells:'Cells per vial',frozenOn:'Date frozen',volume:'Volume per vial',volumeUnit:'Volume unit',type:'Sample type',lot:'Lot / clone',passage:'Passage',concentration:'Concentration',concentrationUnit:'Concentration unit',expiresOn:'Expiry',thaws:'Thaw count',status:'Status',notes:'Notes'};
export function createLifecycle(ctx){
  let operation=null,saving=false,dirty=false;
  const location=(sheet,position)=>{const box=ctx.state().boxes.find(b=>b.sheet===sheet);return `${box?box.temperature+'°C · '+box.id:'Previous box'}${position?' · '+position:''}`};
  function input(key,value,type='text',required=false){return `<label>${fields[key]||key}<input name="${key}" id="edit-${key}" type="${type}" value="${esc(value)}" ${required?'required':''} ${type==='number'?'min="0" step="any"':''} maxlength="${key==='name'?600:300}"></label>`}
  function snapshotHTML(sample){
    const info=sampleInfo(sample);return `<dl class="sample-fields">${Object.entries(fields).filter(([key])=>present(info[key])).map(([key,title])=>`<div><dt>${esc(title)}</dt><dd>${esc(info[key])}</dd></div>`).join('')}</dl>`;
  }
  function fillDestinations(preferred){
    const box=ctx.state().boxes.find(b=>b.sheet===$('operation-box').value),select=$('operation-position');
    select.replaceChildren(new Option('Next available empty position','auto'));
    box?.slots.forEach(s=>{const o=new Option(`${s.position}${s.pendingId?' — pending':s.occupied?' — occupied':''}`,s.position);o.disabled=s.occupied||!!s.pendingId;select.append(o)});
    if(preferred&&[...select.options].some(o=>o.value===preferred&&!o.disabled))select.value=preferred;
  }
  function open(action,ref){
    const state=ctx.state(),record=action==='return'?state.takenOut.find(r=>r.id===ref.id):null;
    const slot=record?.sample||state.boxes.find(b=>b.sheet===ref.sheet)?.slots.find(s=>s.position===ref.position);
    if(!slot)return;
    const info={...sampleInfo(slot),status:slot.detail?.status||''};
    operation={action,...ref,recordId:record?.id,revision:state.revision,requestId:crypto.randomUUID()};dirty=false;
    $('sample-dialog').close();$('archive-dialog').close();
    $('operation-title').textContent={edit:'Edit vial',takeout:'Take out vial',move:'Move vial',return:'Return vial',use:'Record partial use'}[action];
    $('operation-description').textContent=`${info.name} · ${location(record?.sheet||ref.sheet,record?.position||ref.position)}`;
    let html='';
    if(action==='edit'){
      html=input('name',info.name,'text',true)+`<div class="two">${input('source',info.source)}${input('cells',info.cells)}${input('frozenOn',info.frozenOn,'date')}${input('expiresOn',info.expiresOn,'date')}${input('volume',info.volume,'number')}<label>Volume unit<select name="volumeUnit"><option value=""></option>${[...new Set(['µL','mL','L','Other',info.volumeUnit])].filter(Boolean).map(u=>`<option ${u===info.volumeUnit?'selected':''}>${esc(u)}</option>`).join('')}</select></label>${input('type',info.type)}${input('lot',info.lot)}${input('passage',info.passage,'number')}${input('thaws',info.thaws,'number')}${input('concentration',info.concentration,'number')}${input('concentrationUnit',info.concentrationUnit)}${input('status',info.status)}</div><label>Notes<textarea name="notes" maxlength="1200" rows="3">${esc(info.notes)}</textarea></label>`;
    }
    if(action==='takeout')html='<label>What happened to this vial?<select name="disposition"><option value="out">Taken out temporarily — can be returned</option><option value="used_up">Used up</option><option value="discarded">Discarded</option><option value="transferred">Transferred to someone else</option></select></label><p class="operation-explanation">The position will become empty after saving. The full vial record stays in Taken-out vials and Recent changes.</p>';
    if(action==='use')html=`<p class="operation-explanation">Recorded volume: <strong>${esc(info.volume)} ${esc(info.volumeUnit)}</strong>. The remaining volume will stay at this position. If you use the entire vial, choose Take out → Used up.</p><label>Amount used (${esc(info.volumeUnit||'record a unit first')})<input type="number" name="amount" required min="0.000000001" step="any"></label>`;
    if(action==='move'||action==='return')html=`<div class="two"><label>Destination box<select name="targetSheet" id="operation-box">${state.boxes.map(b=>`<option value="${esc(b.sheet)}" ${b.sheet===(record?.sheet||ref.sheet)?'selected':''}>${esc(b.temperature+'°C · '+b.id+' · '+b.contents)}</option>`).join('')}</select></label><label>Destination position<select name="targetPosition" id="operation-position"></select></label></div>${action==='return'?'<label class="check-label"><input name="incrementThaws" type="checkbox"> Add 1 to the thaw count</label><p class="hint">The original date frozen is kept.</p>':''}`;
    html+=`<div class="two"><label>Date of change<input name="operationDate" type="date" value="${today()}" required></label></div><label>${action==='edit'?'Reason for change':'Comment'} <span class="optional">optional</span><textarea name="note" maxlength="1200" rows="2"></textarea></label>`;
    $('operation-fields').innerHTML=html;
    $('operation-error').hidden=true;$('operation-submit').textContent=state.locked?'Save change':'Save change';
    if(action==='move'||action==='return'){fillDestinations(action==='return'?record.position:null);$('operation-box').addEventListener('change',()=>fillDestinations())}
    $('operation-dialog').showModal();
  }
  function closeOperation(){if(saving)return;if(dirty&&!confirm('Discard the unsaved changes to this vial?'))return;$('operation-dialog').close();operation=null;dirty=false}
  $('operation-form').addEventListener('input',()=>{dirty=true});
  $('cancel-operation').addEventListener('click',closeOperation);
  $('operation-dialog').addEventListener('cancel',e=>{e.preventDefault();closeOperation()});
  $('operation-form').addEventListener('submit',async e=>{
    e.preventDefault();if(saving||!operation)return;
    const values=Object.fromEntries(new FormData(e.target)),payload={...operation,...values};
    if(operation.action==='edit'){payload.updates=Object.fromEntries(Object.keys(fields).map(key=>[key,values[key]??'']));delete payload.notes}
    if(operation.action==='return')payload.incrementThaws=values.incrementThaws==='on';
    saving=true;ctx.busy(true);$('operation-submit').disabled=true;$('cancel-operation').disabled=true;$('operation-error').hidden=true;
    try{
      const result=await ctx.api('save',payload);dirty=false;$('operation-dialog').close();operation=null;
      await ctx.saved(result,payload);
    }catch(error){$('operation-error').textContent=error.message;$('operation-error').hidden=false}
    finally{saving=false;ctx.busy(false);$('operation-submit').disabled=false;$('cancel-operation').disabled=false}
  });
  function showArchive(id){
    const record=ctx.state().takenOut.find(r=>r.id===id);if(!record)return;
    $('archive-title').textContent=record.name;
    const pending=ctx.state().pending.some(q=>q.payload?.recordId===id);
    $('archive-body').innerHTML=`<p>${esc(dispositions[record.disposition]||'Taken out')} · ${esc(record.date)}</p><p>Previous location: ${esc(location(record.sheet,record.position))}</p>${record.note?`<p class="sample-notes">${esc(record.note)}</p>`:''}${snapshotHTML(record.sample)}${record.canReturn?`<button type="button" id="return-vial" class="primary" ${pending?'disabled':''}>${pending?'Return pending':'Return to storage'}</button>`:''}`;
    $('return-vial')?.addEventListener('click',()=>open('return',{id}));$('archive-dialog').showModal();
  }
  $('close-archive').addEventListener('click',()=>$('archive-dialog').close());
  function renderArchive(){
    const query=$('archive-search').value.trim().toLowerCase(),records=ctx.state().takenOut||[];
    $('archive-count').textContent=records.length;
    const matches=records.filter(r=>[r.name,r.sheet,r.position,r.note,...Object.values(sampleInfo(r.sample))].join(' ').toLowerCase().includes(query));
    $('archive-list').innerHTML=matches.length?matches.slice().reverse().map(r=>`<button class="archive-item" data-record="${esc(r.id)}"><strong>${esc(r.name)}</strong><span>${esc(dispositions[r.disposition])} · ${esc(r.date)}</span><small>${esc(location(r.sheet,r.position))}</small></button>`).join(''):`<p>${records.length?'No matching taken-out vials.':'Vials you take out will stay here, with their details and removal date.'}</p>`;
    $('archive-list').querySelectorAll('[data-record]').forEach(b=>b.addEventListener('click',()=>showArchive(b.dataset.record)));
  }
  $('archive-search').addEventListener('input',renderArchive);
  function renderActivity(){
    const history=ctx.state().history||[];
    $('history-list').innerHTML=history.length?history.map(e=>`<details class="history-event"><summary><strong>${esc(titles[e.action]||e.action)}${e.names?.length?' · '+esc(e.names.join(', ')):''}</strong><small>${esc(location(e.sheet,e.positions.join(', ')))}${e.target?' → '+esc(location(e.target.sheet,e.target.position)):''} · ${esc(new Date(e.time).toLocaleString())}</small></summary>${e.operationDate?`<p>Date of change: ${esc(e.operationDate)}</p>`:''}${e.disposition?`<p>${esc(dispositions[e.disposition])}</p>`:''}${e.note?`<p class="sample-notes">${esc(e.note)}</p>`:''}${(e.changes||[]).map(c=>`<div class="change-detail"><h3>${esc(location(c.sheet,c.position))}</h3><div class="two"><div><h4>Before</h4>${c.before.label?snapshotHTML(c.before):'<p>Empty</p>'}</div><div><h4>After</h4>${c.after.label?snapshotHTML(c.after):'<p>Empty</p>'}</div></div></div>`).join('')}${!e.changes?'<p>Recorded in your inventory history.</p>':''}</details>`).join(''):'<p>No changes saved through this window yet.</p>';
    renderArchive();
  }
  return {open,renderActivity};
}
