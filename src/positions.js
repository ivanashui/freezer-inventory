// Resolve explicit addresses against the physical box order. Never skip occupied slots.
export function parsePositions(value,box){
  const raw=Array.isArray(value)?value.join(', '):String(value||'').trim();
  if(!raw)return [];
  const parts=raw.toUpperCase().replace(/[–—−]/g,'-').replace(/\s+(?:TO|THROUGH)\s+/g,'-').replace(/\s*-\s*/g,'-').split(/\s*(?:,|\/|&|\bAND\b)\s*|\s+/).filter(Boolean);
  const result=[],seen=new Set();
  const normalize=p=>/^\d+$/.test(p)?String(Number(p)):p;
  for(const part of parts){
    const match=part.match(/^([A-Z]?\d+)(?:-([A-Z]?\d+))?$/);
    if(!match)throw new Error(`Check position “${part}”. Use B2, B3 or B2–B5.`);
    const first=normalize(match[1]);let last=match[2];
    if(last&&/^[A-Z]/.test(first)&&/^\d+$/.test(last))last=first[0]+last;
    last=last?normalize(last):first;
    const a=box.slots.findIndex(s=>s.position===first),b=box.slots.findIndex(s=>s.position===last);
    if(a<0||b<0)throw new Error(`${a<0?first:last} is not a position in ${box.id}. Check the box or position labels.`);
    if(b<a)throw new Error(`Range ${part} runs backwards. List individual positions or put the earlier position first.`);
    for(const slot of box.slots.slice(a,b+1)){
      if(seen.has(slot.position))throw new Error(`Position ${slot.position} is listed more than once.`);
      seen.add(slot.position);result.push(slot.position);
    }
  }
  return result;
}
