export const present=v=>v!==''&&v!==null&&v!==undefined;
export function sampleInfo(slot,pending){
  const p=pending?.payload||{},d=slot.detail||{},label=String(slot.label||'');
  const lines=String(d.notes||'').split('\n');
  const source=lines.find(l=>l.startsWith('Source: '))?.slice(8)||p.source||'';
  const cells=lines.find(l=>l.startsWith('Cells per vial: '))?.slice(16)||(p.mode==='single'?p.cells:'')||'';
  return {
    name:label.split('\n')[0]||'Sample details recorded',label,source,cells,
    frozenOn:d.frozenOn||p.frozenOn||'',type:d.type||p.type||'',
    volume:present(d.volume)?d.volume:(p.volume??''),volumeUnit:d.volumeUnit||p.volumeUnit||'',
    passage:present(d.passage)?d.passage:(p.passage??''),lot:d.lot||p.lot||'',
    notes:lines.filter(l=>!l.startsWith('Source: ')&&!l.startsWith('Cells per vial: ')).join('\n').trim()||p.notes||'',
    concentration:d.concentration??'',concentrationUnit:d.concentrationUnit||'',
    expiresOn:d.expiresOn||'',thaws:d.thaws??'',status:pending?'Pending Excel sync':d.status||'Recorded'
  };
}
