const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let role='owner',within=true,trashed=false,mime='image/jpeg',size=3,reads=0;
const ctx=vm.createContext({JSON,Number,String,encodeURIComponent,propiedad:()=>JSON.stringify(['root']),json:x=>x,nexusArteWithin:()=>within,
DriveApp:{getFileById:()=>({isTrashed:()=>trashed,getAccess:()=>role,getBlob:()=>{reads++;return{getBytes:()=>[1,2,3]}}}),Permission:{OWNER:'owner',EDIT:'edit',VIEW:'view',COMMENT:'comment'}},ScriptApp:{getOAuthToken:()=> 'secret'},UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({id:'a'.repeat(24),mimeType:mime,size,capabilities:{canDownload:true}})})},Utilities:{base64Encode:b=>Buffer.from(b).toString('base64')}});
vm.runInContext(fs.readFileSync('src/modules/anuncios/apps-script/ImagenPrivada.gs','utf8'),ctx);
const req={folderId:'root',fileId:'a'.repeat(24),viewer:'user@example.test'};
assert.equal(ctx.nexusReadImage(req).data,'AQID');
for(const setup of [()=>role='none',()=>{role='owner';within=false},()=>{within=true;trashed=true},()=>{trashed=false;mime='image/svg+xml'},()=>{mime='image/png';size=9*1024*1024}]) {setup();let before=reads;assert.equal(ctx.nexusReadImage(req).ok,false);assert.equal(reads,before);}
const html=fs.readFileSync('index.html','utf8');let calls=0,blobs=0,revoke=0,resolve;let epoch=0;
const ui=vm.createContext({Map,Promise,Blob,Uint8Array,atob,URL:{createObjectURL:()=>{blobs++;return'blob:img'},revokeObjectURL:()=>revoke++},ensureSharedPendingClient:()=>({rpc:()=>{calls++;return new Promise(r=>resolve=r)}}),getSuiteAccessSession:()=>true,adsVideoEpoch:0});
vm.runInContext(html.slice(html.indexOf('      let adsImages ='),html.indexOf('      // Los indices son')),ui);
(async()=>{let a={dataset:{adImage:'id'},isConnected:true},b={dataset:{adImage:'id'},isConnected:true};ui.adsLoadImage(a);ui.adsLoadImage(b);await new Promise(setImmediate);assert.equal(calls,1);resolve({data:{ok:true,id:'id',mime:'image/jpeg',bytes:3,data:'AQID'}});await new Promise(setImmediate);assert.equal(a.src,'blob:img');assert.equal(b.src,'blob:img');assert.equal(blobs,1);
let c={dataset:{adImage:'stale'},isConnected:true};ui.adsLoadImage(c);await new Promise(setImmediate);ui.adsVideoEpoch++;resolve({data:{ok:true,id:'stale',mime:'image/jpeg',bytes:3,data:'AQID'}});await new Promise(setImmediate);assert.equal(c.src,undefined);assert.equal(blobs,1);console.log('Images: ACL, folder, trash, MIME, cap, shared request and stale session: OK');})();
