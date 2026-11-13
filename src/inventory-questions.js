import {sampleInfo} from './sample-info.js';
import {withdrawnRecords} from './operations.js';
import {localDate,validDate} from './note-parser.js';
const norm=s=>String(s||'').toLowerCase().replace(/[−–]/g,'-').replace(/\s+/g,' ').trim();
export function askInventory(state,question,{today=localDate(),lowLimit=2}={}){
  let q=norm(question).replace(/[?!.]+$/,'');if(!q)throw new Error('Ask about a sample, low stock, expiry, or empty positions.');
  let records=state.boxes.flatMap(box=>box.slots.filter(s=>s.occupied).map(slot=>({sheet:box.sheet,position:slot.position,box:box.id,temperature:box.temperature,location:box.location,...sampleInfo(slot)})));
  let intent=/\b(low|running out|remaining stock)\b/.test(q)?'low':/\b(expir|expired|expiring|expiry)/.test(q)?'expiry':/\b(space|empty|capacity|room)\b/.test(q)?'space':/\b(oldest|first|earliest)\b/.test(q)?'oldest':/\b(taken out|removed|withdrawn)\b/.test(q)?'out':/\b(how many|count|number of)\b/.test(q)?'count':'find';
  const temp=q.match(/-(80|20)(?:\s*°?c)?\b/),boxMatch=q.match(/\bbox\s+(\d+)\b/);
  const matchesBox=b=>(!temp||b.temperature===-Number(temp[1]))&&(!boxMatch||Number(norm(b.box||b.id).match(/box\s*0*(\d+)$/)?.[1])===Number(boxMatch[1]));
  records=records.filter(matchesBox);
  let term=q.replace(/-(80|20)(?:\s*°?c)?\b/g,'').replace(/\bbox\s+\d+\b/g,'').replace(/\b(?:freezer|freezers)\b/g,'').trim();
  if(intent==='out')records=withdrawnRecords(state.events).map(r=>{const b=state.boxes.find(b=>b.sheet===r.sheet);return {...sampleInfo(r.sample),...r,recordId:r.id,box:b?.id||'Previous box',temperature:b?.temperature,location:b?.location}}).filter(matchesBox);
  const before=term.match(/\b(?:frozen\s+)?before\s+(\d{4}-\d{2}-\d{2})\b/),after=term.match(/\b(?:frozen\s+)?after\s+(\d{4}-\d{2}-\d{2})\b/);
  if(before||after){for(const m of [before,after].filter(Boolean))if(!validDate(m[1]))throw new Error('Use a real date in YYYY-MM-DD format.');records=records.filter(r=>r.frozenOn&&(!before||r.frozenOn<before[1])&&(!after||r.frozenOn>after[1]));term=term.replace(/\b(?:frozen\s+)?(?:before|after)\s+\d{4}-\d{2}-\d{2}\b/g,'')}
  if(intent==='space'){const boxes=state.boxes.filter(matchesBox).map(b=>({...b,free:b.slots.filter(s=>!s.occupied).length}));return {title:`${boxes.reduce((n,b)=>n+b.free,0)} unrecorded positions across ${boxes.length} boxes`,explanation:'Availability is based on logged records. Check the physical box before placing vials.',boxes,records:[]}}
  term=term.replace(/^(?:please\s+)?(?:where (?:is|are|can i find)|find|search for|show(?: me)?|list|do (?:we|i) have|how many|count|number of|which(?: is| are)?|what(?: is| are)?)\s*/,'').replace(/^(?:the\s+)?(?:oldest|earliest)\s*/,'').replace(/\b(?:taken out|removed|withdrawn)\b/g,'').replace(/^(?:all|in|at)\s+/,'').replace(/["“”]/g,'').trim();
  term=term.replace(/^(?:all\s+)?(?:vials?(?:\s+of)?(?:\s+|$)|samples?\s+of\s+)/,'').replace(/\s+vials?$/,'').trim();
  term=term.replace(/\b(?:running low|running out|remaining stock|low stock|low|expired|expiring|expiry|expires?)\b/g,'').replace(/\b(?:at most|under|below|fewer than|<=?)\s*\d+\b/g,'').replace(/\b(?:within|in|next)?\s*\d+\s*days?\b/g,'').replace(/^(?:vials?\s+)?(?:of|for|from)\s+|\s+(?:in|at|from)$/g,'').trim();
  const position=term.match(/\bposition\s+([a-p](?:1[0-6]|[1-9])|[1-9]\d{0,2})\b/);if(position){records=records.filter(r=>norm(r.position)===position[1]);term=term.replace(position[0],'').trim()}
  const terms=term.split(/\s+/).filter(Boolean);
  if(terms.length)records=records.filter(r=>terms.every(t=>/^[a-p](1[0-6]|[1-9])$/.test(t)?norm(r.position)===t:norm([r.name,r.source,r.lot,r.type,r.notes].join(' ')).includes(t)));
  if(intent==='low'){
    const limit=Number(q.match(/(?:at most|under|below|fewer than|<=?)\s*(\d+)/)?.[1]??lowLimit);if(!Number.isInteger(limit)||limit<0||limit>100)throw new Error('Set the low-stock threshold from 0 to 100 vials.');
    const exclusive=/\b(under|below|fewer than)\s*\d/.test(q),groups=new Map();
    for(const r of records){const key=[r.name,r.source,r.lot].map(norm).join('\u0000');if(!groups.has(key))groups.set(key,{name:r.name,source:r.source,lot:r.lot,records:[]});groups.get(key).records.push(r)}
    const low=[...groups.values()].filter(g=>exclusive?g.records.length<limit:g.records.length<=limit).sort((a,b)=>a.records.length-b.records.length);
    return {title:`${low.length} sample groups ${exclusive?'below':'at or below'} ${limit} vials`,explanation:'Grouped by sample name, source, and lot. These are stored vial counts; depleted groups are not inferred from incomplete history.',groups:low,records:[]};
  }
  if(intent==='expiry'){
    const days=Number(q.match(/\b(\d+)\s*days?/)?.[1]??30);if(days>3650)throw new Error('Choose a window of 3650 days or fewer.');const end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+days);const missing=records.filter(r=>!validDate(r.expiresOn)).length;
    records=records.filter(r=>validDate(r.expiresOn)&&r.expiresOn<=end.toISOString().slice(0,10)).sort((a,b)=>a.expiresOn.localeCompare(b.expiresOn));
    return {title:`${records.length} vials expired or expiring within ${days} days`,explanation:`Uses the recorded expiry date. ${missing} stored vials have no valid expiry recorded.`,records};
  }
  if(intent==='oldest'){const undated=records.filter(r=>!validDate(r.frozenOn)).length;records=records.filter(r=>validDate(r.frozenOn)).sort((a,b)=>a.frozenOn.localeCompare(b.frozenOn));return {title:`${records.length} vials, oldest recorded freeze date first`,explanation:`${undated} matches without a valid freeze date are excluded. Compare the displayed expiry, status and thaw count before selecting a vial.`,records}}
  return {title:`${records.length} ${intent==='out'?'taken-out':'stored'} vial${records.length===1?'':'s'}${term?' matching “'+term+'”':''}`,explanation:records.length?'Click a result for its recorded details.':'Try a sample name or ID, “oldest Sample 001”, “running low”, “expiring in 30 days”, or “free space”.',records};
}
