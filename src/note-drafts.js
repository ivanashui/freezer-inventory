// Save editable interpretation only. A reviewed plan must always be rebuilt
// against the current inventory, including after a refresh or workbook switch.
const key=id=>'freezer-note-state-'+id;
export function saveNoteDraft(storage,id,{text='',box='',rows=[]}){
  if(!id)return;
  if(!text.trim()&&!rows.length){clearNoteDraft(storage,id);return}
  storage.setItem(key(id),JSON.stringify({version:1,text,box,rows}));
}
export function clearNoteDraft(storage,id){storage.removeItem(key(id));storage.removeItem('freezer-note-'+id)}
export function readNoteDraft(storage,id){
  const legacy=()=>({text:storage.getItem('freezer-note-'+id)||'',box:'',rows:[]});
  let saved;try{saved=JSON.parse(storage.getItem(key(id))||'null')}catch{return legacy()}
  if(!saved||saved.version!==1||typeof saved.text!=='string'||!Array.isArray(saved.rows))return legacy();
  const rows=saved.rows.filter(r=>r&&['add','takeout'].includes(r.action)&&typeof r.sheet==='string').map(r=>{
    const issues=Object.fromEntries(Object.entries(r.issues||{}).filter(([,v])=>typeof v==='string'));
    return {...r,issues,errors:Object.values(issues),hints:Array.isArray(r.hints)?r.hints.filter(v=>typeof v==='string'):[],unrecognized:Array.isArray(r.unrecognized)?r.unrecognized.filter(v=>typeof v==='string'):[]};
  });
  return {text:saved.text,box:typeof saved.box==='string'?saved.box:'',rows};
}
