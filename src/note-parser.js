import {parsePositions} from './positions.js';
import {sampleInfo} from './sample-info.js';
const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
export const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
export function validDate(value){const d=new Date(value+'T12:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(+d)&&d.toISOString().slice(0,10)===value}
export function relativeDate(value,today=localDate()){if(value==='today')return today;if(value==='yesterday'){const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}if(!validDate(value))throw new Error('Use a real date as YYYY-MM-DD, today, or yesterday.');return value}
const normal=s=>String(s).toLowerCase().replace(/\s+/g,'').replace(/[−–]/g,'-');
const unquote=s=>s.trim().replace(/^["“]|["”]$/g,'');
export function freshRow(sheet,date=localDate()){return {action:'add',sheet,name:'',quantity:1,cells:'',volume:'',volumeUnit:'µL',frozenOn:date,type:'Other',source:'',notes:'',lot:'',passage:'',concentration:'',concentrationUnit:'',expiresOn:'',thaws:0,status:'Available',start:'auto',position:'',positions:'',disposition:'out',operationDate:date}}
// Extract independent facts before reading the remaining sample name. Quoted names are
// protected, so a sample named "B2" or containing a date is not read as a location.
export function parseNotes(text,state,{sheet=state.boxes[0]?.sheet,today=localDate()}={}){
  const lines=String(text).replace(/\b\d{1,3}(?:,\d{3})+(?=\s*(?:cells|[uµμm]l)\b)/gi,m=>m.replaceAll(',','')).split(/\n|;/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length)throw new Error('Describe what you froze or took out.');
  if(lines.length>50)throw new Error('Use up to 50 lines at a time.');
  const results=[];
  for(const [index,raw] of lines.entries()){
    const row={...freshRow(sheet,today),raw,index,issues:{},hints:[],unrecognized:[]};
    const quotes=[];let remaining=raw.replace(/^[•*]\s*/, '').replace(/"([^"]+)"|“([^”]+)”/g,(_,a,b)=>{quotes.push(a||b);return `§${quotes.length-1}§`});
    const restore=s=>s.replace(/§(\d+)§/g,(_,i)=>quotes[Number(i)]);
    const seen=new Map();
    function set(key,value){if(seen.has(key)&&seen.get(key)!==value){row[key]='';row.issues[key]=`More than one ${key==='sheet'?'box':key} was mentioned. Choose the correct value below.`}else if(!row.issues[key])row[key]=value;seen.set(key,value)}
    function extract(regex,fn){remaining=remaining.replace(regex,(...args)=>{fn(...args);return ' '})}
    // Explicit free text is retained verbatim, without interpreting its contents.
    extract(/\bnotes?\s*[:=]\s*(.+)$/i,(_,v)=>set('notes',restore(v.trim())));
    extract(/\b(?:source\s*[:=]\s*|from\s+)(?!box\s*#?\s*\d)([^,]+?)(?=\s+(?:(?:in|into|at)\s+(?:box\b|[A-P]\d|\d)|today\b|yesterday\b|box\s*\d|\d+(?:\.\d+)?\s*(?:[uµμm]l|cells)\b)|,|$)/i,(_,v)=>set('source',restore(v.trim())));
    extract(/\btype\s*[:=]\s*(cell line|reagent|other)\b/gi,(_,v)=>set('type',v.toLowerCase()==='cell line'?'Cell line':v.toLowerCase()==='reagent'?'Reagent':'Other'));
    extract(/\blot\s*[:=]\s*([^,]+)/i,(_,v)=>set('lot',restore(v.trim())));
    const datePattern=/\b(?:on\s+)?(today|yesterday|\d{4}[-.]\d{1,2}[-.]\d{1,2})\b/gi;
    extract(datePattern,(_,v)=>{try{let d=v.toLowerCase();if(/^\d/.test(d)){const p=d.split(/[-.]/);d=[p[0],p[1].padStart(2,'0'),p[2].padStart(2,'0')].join('-')}set('frozenOn',relativeDate(d,today));row.operationDate=row.frozenOn}catch{row.frozenOn='';row.operationDate='';row.issues.frozenOn='Check the date below; that date is not valid.'}});
    let requestedBox='',temperature=null;
    extract(/(?:\bat\s+)?[−-](80|20)\s*(?:°?C)?\b/gi,(_,v)=>{const n=-Number(v);if(temperature!==null&&temperature!==n)row.issues.sheet='Two freezer temperatures were mentioned. Choose the box below.';temperature=n});
    extract(/\b(?:in\s+|into\s+|to\s+|from\s+)?box\s*#?\s*(\d+)\b/gi,(_,v)=>{const id='Box '+Number(v);if(requestedBox&&normal(requestedBox)!==normal(id))row.issues.sheet='More than one box was mentioned. Use one box per line.';requestedBox=id});
    // Non-numbered box names can be written exactly as they appear in the selector.
    if(!requestedBox){for(const b of [...state.boxes].sort((a,b)=>b.id.length-a.id.length)){if(/^box\s*\d+$/i.test(b.id))continue;const safe=b.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const re=new RegExp('(?:^|[, ]+)(?:in\\s+|into\\s+|box:\\s*)?'+safe+'(?=,|$)','i');if(re.test(remaining)){remaining=remaining.replace(re,' ');requestedBox=b.id;break}}}
    if(requestedBox||temperature!==null){const choices=state.boxes.filter(b=>(!requestedBox||normal(b.id).replace(/box0+(?=\d)/,'box')===normal(requestedBox))&&(temperature===null||b.temperature===temperature));if(choices.length===1&&!row.issues.sheet)row.sheet=choices[0].sheet;else{row.sheet='';row.issues.sheet ||= choices.length?'That box is ambiguous across freezers. Choose the correct box below.':'Box not found. Choose an existing box below.'}}
    const number='(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+]?\\d+)?';
    extract(new RegExp('\\b(?:with\\s+|at\\s+)?(?:cells\\s*[:=]\\s*)?('+number+')(?:\\s*(million|thousand|m))?\\s*cells(?:\\s*(?:each|(?:per|/)\\s*vial))?\\b','gi'),(_,v,scale)=>set('cells',String(Number(v)*(/^(million|m)$/i.test(scale||'')?1e6:/^thousand$/i.test(scale||'')?1e3:1))));
    extract(/\b(?:with\s+|at\s+)?(?:volume\s*[:=]\s*)?(\d+(?:\.\d+)?)\s*(ul|µl|μl|ml|l)\b(?:\s*(?:each|(?:per|\/)\s*vial))?/gi,(_,v,u)=>{set('volume',Number(v));set('volumeUnit',/^[uµμ]/i.test(u)?'µL':/^m/i.test(u)?'mL':'L')});
    extract(/\b(?:passage\s*[:=]?\s*P?|P)(\d+)\b/gi,(_,v)=>set('passage',Number(v)));
    let quantityGiven=false;
    extract(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s*(?:vials?|tubes?|aliquots?)\b/gi,(_,v)=>{quantityGiven=true;set('quantity',words[v.toLowerCase()]||(/^(a|an)$/i.test(v)?1:Number(v)))});
    let actionFound=false;
    extract(/\b(?:(?:I|we)\s+)?(took out|take out|removed?|used up|discarded?|froze|freeze|frozen|stored?|add(?:ed)?|log(?:ged)?|put)\b/i,(_,v)=>{actionFound=true;if(/^(took|take|remov|used|discard)/i.test(v)){row.action='takeout';row.disposition=/used up/i.test(v)?'used_up':/discard/i.test(v)?'discarded':'out'}});
    if(!actionFound)row.issues.action='Start with a freezing or take-out action, such as “froze” or “took out”.';
    if(/\b(?:took out|take out|froze|freeze|removed|discarded)\b/i.test(remaining))row.issues.action='Put each freezing or take-out action on its own line.';
    extract(/\bstart(?:ing)?(?:\s+at)?\s*[:=]?\s*([A-P]\d{1,2}|\d{1,3})\b/gi,(_,v)=>set('start',v.toUpperCase()));
    const box=state.boxes.find(b=>b.sheet===row.sheet),numeric=box?.numbering==='numeric';
    const atom=numeric?'\\d{1,3}':'[A-P]\\d{1,2}';
    const range=atom+'(?:\\s*(?:[-–—]|to|through)\\s*(?:'+atom+'|\\d{1,3}))?';
    const list=range+'(?:\\s*(?:,\\s*(?:and\\s+)?|and\\s+|&\\s*|/\\s*|\\s+)'+range+')*';
    const addressPattern=new RegExp('(?:\\b(?:at|positions?|slots?|wells?)\\s*[:=]?\\s*|,\\s*|'+(numeric?'^\\s*':'(?<![\\w-])')+')('+list+')(?=\\s*(?:[, .]*$|,))','gi');
    const addressChunks=[];remaining=remaining.replace(addressPattern,(_,v)=>{addressChunks.push(v);return ' '});const addresses=addressChunks.join(', ');
    // The row can be edited even when an address, box, or count needs correction.
    if(addresses){row.positions=addresses.trim();if(box){try{const ps=parsePositions(addresses,box);row.positions=ps.join(', ');if(!quantityGiven){row.quantity=ps.length;row.hints.push(`Vial count set from ${ps.length} listed positions.`)}}catch(e){row.issues.positions=e.message}}}
    remaining=remaining.replace(/^[\s,.:]+|[\s,.:]+$/g,'').replace(/^(?:of\s+|the\s+)+/i,'').replace(/\s+(?:in|into|at|and|with)\s*$/i,'').trim();
    const clauses=remaining.split(',').map(x=>restore(x.trim())).filter(x=>x&&!/^(?:in|into|at|and|of|with)$/i.test(x));
    row.name=unquote(clauses.shift()||'');
    const known=state.boxes.some(b=>b.slots.some(s=>s.occupied&&normal(sampleInfo(s).name)===normal(row.name)));
    if(!known&&!quotes.length)row.name=row.name.replace(/^sample\s+(?!(?:\d|[A-Z]$))/i,'').replace(/^(?:named|called)\s+/i,'');
    for(const extra of clauses){row.unrecognized.push(extra);row.notes=[row.notes,'Unparsed note: '+extra].filter(Boolean).join('\n')}
    if(row.unrecognized.length)row.issues.notes='Some extra wording was kept in Notes. Check it below.';
    row.name=row.name.replace(/\s+/g,' ').trim();
    if(row.action==='add'&&!row.name)row.issues.name='Enter the sample name below.';
    if(!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>100)row.issues.quantity='Use 1 to 100 vials per entry.';
    if(row.action==='takeout'){
      if(row.start!=='auto'&&!row.positions){row.positions=row.start;row.start='auto'}
      if(row.positions&&box){try{const ps=parsePositions(row.positions,box);if(quantityGiven&&row.quantity!==ps.length)row.issues.quantity=`The count (${row.quantity}) and listed positions (${ps.length}) differ. Correct the original note.`;
        for(const position of ps){const slot=box.slots.find(s=>s.position===position),child={...row,issues:{...row.issues},position,quantity:1,positions:'',expectedName:row.name};if(row.name&&slot?.occupied&&normal(sampleInfo(slot).name)!==normal(row.name))child.issues.position='This position contains a different sample. Check the vial selector below.';child.errors=Object.values(child.issues);results.push(child)}continue;
      }catch(e){row.issues.position=e.message;row.positions=''}}
      if(!row.position&&row.name){const matches=state.boxes.filter(b=>(!requestedBox||b.sheet===row.sheet)&&(temperature===null||b.temperature===temperature)).flatMap(b=>b.slots.filter(s=>s.occupied&&normal(sampleInfo(s).name)===normal(row.name)).map(s=>({sheet:b.sheet,position:s.position})));if(matches.length===1)Object.assign(row,matches[0]);else row.needsPosition=matches.length?'Several vials match. Choose the exact box and position below.':'Choose the correct vial below.'}
    }
    row.errors=Object.values(row.issues);results.push(row);
  }
  if(results.length>50)throw new Error('Prepare up to 50 entries or individual take-outs at a time.');
  return results;
}
export function parseLabelText(text,{sheet,today=localDate()}={}){
  const row=freshRow(sheet,today),lines=String(text).split('\n').map(s=>s.trim()).filter(Boolean);row.frozenOn='';row.notes='Label transcription:\n'+text;
  for(const line of lines){let m;
    if((m=line.match(/^(?:sample(?: name)?|name|id)\s*[:=]\s*(.+)$/i)))row.name=m[1];
    else if((m=line.match(/^(?:source|from)\s*[:=]\s*(.+)$/i)))row.source=m[1];
    else if((m=line.match(/(?:^|\s)(\d{4})[-.](\d{2})[-.](\d{2})(?:\s|$)/))){const d=m.slice(1).join('-');if(validDate(d))row[/expir/i.test(line)?'expiresOn':'frozenOn']=d;}
    else if((m=line.match(/^(?:volume\s*[:=]\s*)?(\d+(?:\.\d+)?)\s*(uL|µL|μL|mL|L)(?:\s*(?:each|\/vial|per vial))?$/i))){row.volume=Number(m[1]);row.volumeUnit=/^[uµμ]/i.test(m[2])?'µL':/^m/i.test(m[2])?'mL':'L'}
    else if((m=line.match(/^(?:cells\s*[:=]\s*)?([\d.]+(?:e[+]?\d+)?)\s*(million|thousand)?\s*cells(?:\s*(?:each|\/vial|per vial))?$/i)))row.cells=String(Number(m[1])*(m[2]?.toLowerCase()==='million'?1e6:m[2]?.toLowerCase()==='thousand'?1e3:1));
    else if((m=line.match(/^(?:passage\s*[:=]?\s*P?|P)(\d+)$/i)))row.passage=Number(m[1]);
    else if((m=line.match(/^lot\s*[:=]\s*(.+)$/i)))row.lot=m[1];
    else if(!row.name)row.name=line;
  }
  return row;
}
