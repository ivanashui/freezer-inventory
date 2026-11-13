import {sampleInfo} from './sample-info.js';
import {withdrawnRecords} from './operations.js';
import {localDate,validDate} from './note-parser.js';
const norm=s=>String(s||'').toLowerCase().replace(/[−–]/g,'-').replace(/\s+/g,' ').trim();
const escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const content=r=>norm([r.name,r.source,r.lot,r.type,r.notes].join(' '));
function cleanTerm(term){
  return term.replace(/^(?:please\s+)?(?:where (?:is|are|can i find)|find|search for|show(?: me)?|list|do (?:we|i) have|how many|count|number of|which(?: is| are)?|what(?: is| are)?)\s*/,'')
    .replace(/\b(?:do (?:we|i) have|are there)\s*$/,'').replace(/^all\s+/,'').trim();
}
function trimConnectors(term){
  const words=term.trim().split(/\s+/);while(/^(?:all|in|at|from|of|for|and|the)$/.test(words[0]||''))words.shift();while(/^(?:in|at|from|of|for|and)$/.test(words.at(-1)||''))words.pop();return words.join(' ');
}
export function askInventory(state,question,{today=localDate(),lowLimit=2}={}){
  const literals=[];
  let q=norm(question).replace(/"([^"]+)"|“([^”]+)”/g,(_,a,b)=>{literals.push(a||b);return ` quotedliteral${literals.length-1} `}).replace(/[?!.]+$/,'').trim();
  if(!q)throw new Error('Ask about a sample, low stock, expiry, or empty positions.');
  let records=state.boxes.flatMap(box=>box.slots.filter(s=>s.occupied).map(slot=>({sheet:box.sheet,position:slot.position,box:box.id,temperature:box.temperature,location:box.location,...sampleInfo(slot)})));
  // A direct name/location search must not turn "Sample Low" into a low-stock query.
  const lookupPrefix=/^(?:please\s+)?(?:where (?:is|are|can i find)|find|search for)\s*/;
  const explicitFind=lookupPrefix.test(q)&&!/^(?:all\s+|the\s+)?(?:expired|expiring|unexpired|low stock|running low|oldest|earliest|empty|available space|taken out|removed|withdrawn|used up|discarded|transferred)\b/.test(q.replace(lookupPrefix,''));
  const explicitCount=/^(?:how many|count|number of)\s+vials?\s+of\b/.test(q);
  const intent=explicitFind?'find':explicitCount?'count':/\b(low|running out|remaining stock)\b/.test(q)?'low':/\b(expired|expiring|expiry|expires?|unexpired)\b/.test(q)?'expiry':/\b(space|empty|capacity|room)\b/.test(q)?'space':/\b(oldest|earliest)\b/.test(q)?'oldest':/\b(taken out|removed|withdrawn|used up|discarded|transferred)\b/.test(q)?'out':/\b(how many|count|number of)\b/.test(q)?'count':'find';
  let term=q;
  const temp=term.match(/(?<![\w-])-(80|20)(?:\s*°?c)?\b/),boxMatch=term.match(/\bbox\s*#?\s*0*(\d+)\b/);
  term=term.replace(/(?<![\w-])-(80|20)(?:\s*°?c)?\b/g,'').replace(/\bbox\s*#?\s*0*\d+\b/g,'').replace(/\b(?:freezer|freezers)\b/g,'');
  let namedBox='';
  for(const box of [...state.boxes].sort((a,b)=>b.id.length-a.id.length)){
    const id=norm(box.id);if(/^(?:-\d+\s*)?box\s*\d+$/.test(id))continue;
    const re=new RegExp('\\b(?:in|at|from)\\s+'+escaped(id)+'(?=\\s|$)','i');
    if(re.test(term)){namedBox=id;term=term.replace(re,'');break}
  }
  const matchesBox=b=>(!temp||b.temperature===-Number(temp[1]))&&(!boxMatch||Number(norm(b.box||b.id).match(/\bbox\s*0*(\d+)\b/)?.[1])===Number(boxMatch[1]))&&(!namedBox||norm(b.box||b.id)===namedBox);
  if(intent==='out')records=withdrawnRecords(state.events).map(r=>{const b=state.boxes.find(b=>b.sheet===r.sheet);return {...sampleInfo(r.sample),...r,recordId:r.id,box:b?.id||'Previous box',temperature:b?.temperature,location:b?.location}});
  records=records.filter(matchesBox);
  const filters=[];
  term=term.replace(/\b(?:(frozen|taken out|removed|withdrawn)\s+)?(before|after)\s+(\d{4}-\d{2}-\d{2})\b/g,(_,label,direction,date)=>{
    if(!validDate(date))throw new Error('Use a real date in YYYY-MM-DD format.');
    const field=label==='frozen'?'frozenOn':intent==='out'?'date':'frozenOn';filters.push({field,direction,date});return ' ';
  });
  for(const f of filters)records=records.filter(r=>validDate(r[f.field])&&(f.direction==='before'?r[f.field]<f.date:r[f.field]>f.date));
  const scope=filters.length?' Date filters use '+[...new Set(filters.map(f=>f.field==='date'?'the take-out date':'the freeze date'))].join(' and ')+'.':'';
  if(intent==='space'){
    const unused=trimConnectors(cleanTerm(term).replace(/\b(?:free|available|empty|remaining|space|positions?|slots?|capacity|room|is|there)\b/g,'').replace(/\s+/g,' ').trim());
    if(unused||filters.length||literals.length)throw new Error('For available space, specify a box or freezer, such as “free space in box7” or “free space in -80°C”. Other filters cannot be applied to empty positions.');
    const boxes=state.boxes.filter(matchesBox).map(b=>({...b,free:b.slots.filter(s=>!s.occupied).length}));
    return {title:`${boxes.reduce((n,b)=>n+b.free,0)} unrecorded positions across ${boxes.length} boxes`,explanation:'Availability is based on logged records. Check the physical box before placing vials.',boxes,records:[]};
  }
  term=cleanTerm(term);
  if(intent==='oldest')term=term.replace(/\b(?:oldest|earliest)\b/g,'');
  if(intent==='out'){
    const disposition=/\bused up\b/.test(q)?'used_up':/\bdiscarded\b/.test(q)?'discarded':/\btransferred\b/.test(q)?'transferred':'';
    if(disposition)records=records.filter(r=>r.disposition===disposition);
    term=term.replace(/\b(?:taken out|removed|withdrawn|used up|discarded|transferred)\b/g,'');
  }
  if(intent==='low')term=term.replace(/\b(?:running low|running out|remaining stock|low stock|low)\b/g,'').replace(/(?:at most|under|below|fewer than|<=?)\s*\d+(?:\.\d+)?/g,'');
  if(intent==='expiry')term=term.replace(/\b(?:not expired|unexpired|expired|expiring|expiry|expires?)\b/g,'').replace(/\b(?:within|in|next)\s*-?\d+(?:\.\d+)?\s*days?\b|\b\d+(?:\.\d+)?\s*days?\b/g,'').replace(/\b(?:today|tomorrow|soon)\b/g,'');
  term=trimConnectors(term.replace(/quotedliteral\d+/g,'').replace(/\s+/g,' ').trim());
  term=term.replace(/^(?:all\s+)?(?:vials?(?:\s+of)?(?:\s+|$)|samples?\s+of\s+)/,'').replace(/\s+vials?$/,'').trim();
  term=trimConnectors(term);
  if(/^(?:vials?|samples?)$/.test(term))term='';
  const position=term.match(/\bposition\s*#?\s*([a-p](?:1[0-6]|[1-9])|[1-9]\d{0,2})\b/);if(position){records=records.filter(r=>norm(r.position)===position[1]);term=trimConnectors(term.replace(position[0],'').trim())}
  const terms=term.split(/\s+/).filter(Boolean);
  records=records.filter(r=>literals.every(t=>content(r).includes(t))&&terms.every(t=>/^[a-p](1[0-6]|[1-9])$/.test(t)?norm(r.position)===t:content(r).includes(t)));
  if(intent==='low'){
    const limit=Number(q.match(/(?:at most|under|below|fewer than|<=?)\s*(\d+(?:\.\d+)?)/)?.[1]??lowLimit);if(!Number.isInteger(limit)||limit<0||limit>100)throw new Error('Set the low-stock threshold from 0 to 100 whole vials.');
    const exclusive=/(?:\b(?:under|below|fewer than)\s*|<(?!=)\s*)\d/.test(q),groups=new Map();
    for(const r of records){const key=[r.name,r.source,r.lot].map(norm).join('\u0000');if(!groups.has(key))groups.set(key,{name:r.name,source:r.source,lot:r.lot,records:[]});groups.get(key).records.push(r)}
    const low=[...groups.values()].filter(g=>exclusive?g.records.length<limit:g.records.length<=limit).sort((a,b)=>a.records.length-b.records.length);
    return {title:`${low.length} sample groups ${exclusive?'below':'at or below'} ${limit} vials`,explanation:'Grouped by sample name, source, and lot. These are stored vial counts; depleted groups are not inferred from incomplete history.'+scope,groups:low,records:[]};
  }
  if(intent==='expiry'){
    if(!validDate(today))throw new Error('A valid current date is required for expiry comparisons.');
    const days=Number(q.match(/(-?\d+(?:\.\d+)?)\s*days?/)?.[1]??30);if(!Number.isInteger(days)||days<0||days>3650)throw new Error('Choose an expiry window from 0 to 3650 whole days.');
    const end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+days);const missing=records.filter(r=>!validDate(r.expiresOn)).length;
    const unexpired=/\b(?:not expired|unexpired)\b/.test(q),expiredOnly=/\bexpired\b/.test(q)&&!unexpired&&!/\bexpiring\b/.test(q),exactDay=/\b(today|tomorrow)\b/.exec(q)?.[1];
    const specific=new Date(today+'T12:00:00Z');if(exactDay==='tomorrow')specific.setUTCDate(specific.getUTCDate()+1);
    records=records.filter(r=>validDate(r.expiresOn)&&(unexpired?r.expiresOn>=today:expiredOnly?r.expiresOn<today:exactDay?r.expiresOn===specific.toISOString().slice(0,10):r.expiresOn<=end.toISOString().slice(0,10))).sort((a,b)=>a.expiresOn.localeCompare(b.expiresOn));
    const description=unexpired?'not yet past their recorded expiry':expiredOnly?'past their recorded expiry':exactDay?'with a recorded expiry '+exactDay:`expired or expiring within ${days} days`;
    return {title:`${records.length} vials ${description}`,explanation:`Uses the recorded expiry date; a date before today is counted as expired. ${missing} matching stored vials have no valid expiry recorded and are excluded.`+scope,records};
  }
  if(intent==='oldest'){const undated=records.filter(r=>!validDate(r.frozenOn)).length;records=records.filter(r=>validDate(r.frozenOn)).sort((a,b)=>a.frozenOn.localeCompare(b.frozenOn));return {title:`${records.length} vials, oldest recorded freeze date first`,explanation:`${undated} matches without a valid freeze date are excluded. Compare the displayed expiry, status and thaw count before selecting a vial.`+scope,records}}
  const displayTerm=[term,...literals].filter(Boolean).join(' ');
  return {title:`${records.length} ${intent==='out'?'taken-out':'stored'} vial${records.length===1?'':'s'}${displayTerm?' matching “'+displayTerm+'”':''}`,explanation:(records.length?'Click a result for its recorded details.':'Try a sample name or ID, “oldest Sample 001”, “running low”, “expiring in 30 days”, or “free space”.')+scope,records};
}
