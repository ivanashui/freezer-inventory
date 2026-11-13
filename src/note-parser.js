const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
export const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
export function validDate(value){const d=new Date(value+'T12:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(+d)&&d.toISOString().slice(0,10)===value}
export function relativeDate(value,today=localDate()){if(value==='today')return today;if(value==='yesterday'){const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}if(!validDate(value))throw new Error('Use a real date as YYYY-MM-DD, today, or yesterday.');return value}
const normal=s=>String(s).toLowerCase().replace(/\s+/g,'').replace(/[−–]/g,'-');
const unquote=s=>s.trim().replace(/^["“]|["”]$/g,'');
export function freshRow(sheet,date=localDate()){return {action:'add',sheet,name:'',quantity:1,cells:'',volume:'',volumeUnit:'µL',frozenOn:date,type:'Other',source:'',notes:'',lot:'',passage:'',concentration:'',concentrationUnit:'',expiresOn:'',thaws:0,status:'Available',start:'auto',position:'',disposition:'out',operationDate:date}}
export function parseNotes(text,state,{sheet=state.boxes[0]?.sheet,today=localDate()}={}){
  const lines=String(text).replace(/(\d),(?=\d{3}(?:\D|$))/g,'$1').split(/\n|;/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length)throw new Error('Describe what you froze or took out.');if(lines.length>50)throw new Error('Use up to 50 lines at a time.');
  return lines.map((raw,index)=>{
    const row={...freshRow(sheet,today),raw,index},errors=[];let clauses=raw.split(/,\s*/),head=clauses.shift().trim();
    const tail=head.match(/\s+(today|yesterday)$/i);if(tail){head=head.slice(0,-tail[0].length);row.frozenOn=relativeDate(tail[1].toLowerCase(),today);row.operationDate=row.frozenOn}
    let m=head.match(/^(?:I\s+)?(?:froze|freeze|stored?|add(?:ed)?|log)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:vials?|tubes?|aliquots?)\s+(?:of\s+)?(.+)$/i);
    if(m){row.name=unquote(m[2]);row.quantity=words[m[1].toLowerCase()]||Number(m[1]);if(/\b\d+(?:\.\d+)?\s*(?:[uµμm]l|million cells|cells per vial)\b|\s+(?:in|into)\s+box\s+\d/i.test(row.name))errors.push('Separate sample name, amounts, and box with commas so each detail can be checked.');}
    else if((m=head.match(/^(?:I\s+)?(took out|take out|removed?|used up|discarded?)\s+(.+)$/i))){row.action='takeout';row.disposition=/used up/i.test(m[1])?'used_up':/discard/i.test(m[1])?'discarded':'out';const target=unquote(m[2]);if(/^(?:[A-P](?:1[0-6]|[1-9])|[1-9]\d{0,2})$/i.test(target))row.position=target.toUpperCase();else row.name=target.replace(/^1\s+vial\s+(?:of\s+)?/i,'')}
    else errors.push('Start with “Froze 3 vials of Sample 001” or “Took out A1”. Use one action per line.');
    let requestedBox='',temperature=null;
    for(let clause of clauses){clause=clause.trim();if(!clause)continue;
      if((m=clause.match(/^(?:on\s+)?(today|yesterday|\d{4}-\d{2}-\d{2})$/i))){try{row.frozenOn=relativeDate(m[1].toLowerCase(),today);row.operationDate=row.frozenOn}catch(e){errors.push(e.message)}}
      else if((m=clause.match(/^(?:at\s+)?[−-](80|20)\s*(?:°?C)?$/i)))temperature=-Number(m[1]);
      else if((m=clause.match(/^(?:(?:in|into|to)\s+)?(?:([−-](?:80|20))\s*(?:°?C)?\s+)?(box\s*.+)$/i))){requestedBox=m[2];if(m[1])temperature=Number(m[1].replace('−','-'))}
      else if((m=clause.match(/^(?:cells\s*[:=]\s*)?([\d.]+(?:e[+]?\d+)?)(?:\s*(million|thousand))?\s*cells(?:\s*(?:each|(?:per|\/)\s*vial))?$/i))){const count=Number(m[1])*(m[2]?.toLowerCase()==='million'?1e6:m[2]?.toLowerCase()==='thousand'?1e3:1);if(!Number.isFinite(count)||count<0)errors.push('Check the cell count.');else row.cells=String(count)}
      else if((m=clause.match(/^(?:volume\s*[:=]\s*)?(\d+(?:\.\d+)?)\s*(ul|µl|μl|ml|l)(?:\s*(?:each|(?:per|\/)\s*vial))?$/i))){row.volume=Number(m[1]);row.volumeUnit=/^[uµμ]/i.test(m[2])?'µL':/^m/i.test(m[2])?'mL':'L'}
      else if((m=clause.match(/^(?:source\s*[:=]|from)\s*(.+)$/i)))row.source=m[1];
      else if((m=clause.match(/^(?:passage\s*[:=]?\s*P?|P)(\d+)$/i)))row.passage=Number(m[1]);
      else if((m=clause.match(/^(?:start(?:ing)?(?:\s+at)?|position)\s*[:=]?\s*([A-P](?:1[0-6]|[1-9])|[1-9]\d{0,2})$/i)))row[row.action==='add'?'start':'position']=m[1].toUpperCase();
      else if((m=clause.match(/^type\s*[:=]\s*(cell line|reagent|other)$/i)))row.type=m[1].toLowerCase()==='cell line'?'Cell line':m[1].toLowerCase()==='reagent'?'Reagent':'Other';
      else if((m=clause.match(/^lot\s*[:=]\s*(.+)$/i)))row.lot=m[1];
      else if((m=clause.match(/^notes?\s*[:=]\s*(.+)$/i)))row.notes=m[1];
      else errors.push(`Unrecognized detail: “${clause}”. Keep separate details comma-separated; put free text after “notes:”.`);
    }
    if(requestedBox||temperature!==null){const boxes=state.boxes.filter(b=>(!requestedBox||normal(b.id)===normal(requestedBox))&&(temperature===null||b.temperature===temperature));if(boxes.length===1)row.sheet=boxes[0].sheet;else errors.push(boxes.length?'That box name is ambiguous. Include −80°C or −20°C.':'That box was not found. Check its name.');}
    if(row.action==='takeout'&&row.name&&!row.position){const matches=[];for(const box of state.boxes)for(const slot of box.slots)if(slot.occupied&&normal(slot.label.split('\n')[0])===normal(row.name)&&(!requestedBox||box.sheet===row.sheet)&&(temperature===null||box.temperature===temperature))matches.push({sheet:box.sheet,position:slot.position});if(matches.length===1)Object.assign(row,matches[0]);else row.needsPosition=matches.length?'Several vials match. Choose the exact box and position below.':'No exact name match. Choose the correct box and position below.';}
    if(row.quantity<1||row.quantity>100||!Number.isInteger(row.quantity))errors.push('Use 1 to 100 vials per line.');
    return {...row,errors};
  });
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
