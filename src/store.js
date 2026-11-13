import {emptyState,hydrate,serialize,act} from './model.js';
export async function createStore({factory=globalThis.indexedDB,databaseName='freezer-inventory-v1:'+new URL('.',location.href).pathname}={}){
  if(!factory)throw new Error('This browser cannot save inventory locally. Try Chrome, Edge, Firefox or Safari with browser storage enabled.');
  const db=await new Promise((resolve,reject)=>{const req=factory.open(databaseName,1);req.onupgradeneeded=()=>{req.result.createObjectStore('workbooks',{keyPath:'id'});req.result.createObjectStore('settings')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
  let selectedId;
  function request(store,method,...args){return new Promise((resolve,reject)=>{const req=store[method](...args);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  async function read(name,key){const tx=db.transaction(name,'readonly');return request(tx.objectStore(name),'get',key)}
  function unpack(row){const state=hydrate(row.data,row.revision);return {...state,workbookId:row.id,workbookName:row.name,updatedAt:row.updatedAt}}
  async function saveSelection(id){await new Promise((resolve,reject)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(id,'selected');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
  const api={
    async list(){const tx=db.transaction('workbooks','readonly');return (await request(tx.objectStore('workbooks'),'getAll')).map(({id,name,updatedAt})=>({id,name,updatedAt})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))},
    async select(id){const row=await read('workbooks',id);if(!row)throw new Error('This workbook is no longer available in this browser.');selectedId=id;await saveSelection(id);return unpack(row)},
    async create(name,data=serialize(emptyState())){
      hydrate(data);const row={id:crypto.randomUUID(),name:String(name||'My freezer inventory').trim().slice(0,150),revision:0,data,updatedAt:new Date().toISOString()};
      await new Promise((resolve,reject)=>{const tx=db.transaction('workbooks','readwrite');tx.objectStore('workbooks').add(row);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
      selectedId=row.id;await saveSelection(selectedId);return unpack(row);
    },
    async load(){if(!selectedId)selectedId=await read('settings','selected');if(!selectedId){const records=await api.list();if(records.length)selectedId=records[0].id;else return api.create('My freezer inventory')}
      const row=await read('workbooks',selectedId);if(!row)throw new Error('Choose a workbook saved in this browser.');return unpack(row)},
    async save(state,payload){
      if(state.workbookId!==selectedId)throw new Error('The selected workbook changed. Refresh before saving.');
      const next=act(state,payload),data=serialize(next);
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('workbooks','readwrite'),store=tx.objectStore('workbooks'),get=store.get(selectedId);let saved,error;
        get.onsuccess=()=>{const current=get.result;if(!current){error=new Error('This workbook is unavailable. Refresh before saving.');tx.abort();return}
          if(current.lastRequestId===payload.requestId){saved=current;return}
          if(current.revision!==state.revision){error=new Error('This workbook changed in another tab. Refresh and review your entry before saving.');tx.abort();return}
          saved={...current,data,revision:current.revision+1,lastRequestId:payload.requestId,updatedAt:new Date().toISOString()};store.put(saved);
        };
        tx.oncomplete=()=>resolve(unpack(saved));tx.onabort=()=>reject(error||tx.error||new Error('Browser storage could not save this change. Download a backup before closing.'));tx.onerror=()=>reject(tx.error);
      });
    },
    close(){db.close()},
  };
  return api;
}
