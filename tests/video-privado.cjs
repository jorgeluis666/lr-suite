const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let role='owner',trashed=false,within=true,size=3,restricted=false,reads=0;
const file={isTrashed:()=>trashed,getAccess:()=>role,getBlob:()=>{reads++;return {getBytes:()=>[1,2,3]}}};
const ctx=vm.createContext({JSON,Number,String,encodeURIComponent,
 propiedad:()=>JSON.stringify(['root']),json:x=>x,nexusArteWithin:()=>within,
 DriveApp:{getFileById:()=>file,Permission:{OWNER:'owner',EDIT:'edit',VIEW:'view',COMMENT:'comment'}},
 ScriptApp:{getOAuthToken:()=> 'server-only'},
 UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({id:'a'.repeat(24),mimeType:'video/mp4',size,copyRequiresWriterPermission:restricted,capabilities:{canDownload:true}})})},
 Utilities:{base64Encode:b=>Buffer.from(b).toString('base64')}
});
vm.runInContext(fs.readFileSync('src/modules/anuncios/apps-script/VideoPrivado.gs','utf8'),ctx);
const req={folderId:'root',fileId:'a'.repeat(24),viewer:'owner@example.test'};
assert.equal(ctx.nexusReadVideo(req).data,'AQID');
for(const setup of [()=>role='none',()=>{role='view';restricted=true},()=>{role='owner';trashed=true},()=>{trashed=false;within=false},()=>{within=true;size=50*1024*1024}]){
 setup();const n=reads;assert.equal(ctx.nexusReadVideo(req).ok,false);assert.equal(reads,n);
}
const html=fs.readFileSync('index.html','utf8');
let resolveRpc,blobs=0,revoked=0;
const ui=vm.createContext({console,Blob,Uint8Array,atob,URL:{createObjectURL:()=>{blobs++;return 'blob:test'},revokeObjectURL:()=>revoked++},
 ensureSharedPendingClient:()=>({rpc:()=>new Promise(r=>resolveRpc=r)}),getSuiteAccessSession:()=>true,
 adsCurrentMonth:()=>({anuncios:[{creativo:{archivoId:'test'}}]}),adsModule(){},state:{active:'ads'}});
vm.runInContext(html.slice(html.indexOf('      let adsPlaying ='),html.indexOf('      function adsBrandList')),ui);
(async()=>{
 const stale=ui.adsPlayPrivate(0);ui.adsResetViewState();resolveRpc({data:{ok:true,id:'test',mime:'video/mp4',bytes:3,data:'AQID'}});await stale;assert.equal(blobs,0);
 const good=ui.adsPlayPrivate(0);resolveRpc({data:{ok:true,id:'test',mime:'video/mp4',bytes:3,data:'AQID'}});await good;assert.equal(blobs,1);ui.adsResetViewState();assert.equal(revoked,1);
 const bad=ui.adsPlayPrivate(0);resolveRpc({data:{ok:true,id:'other',mime:'video/mp4',bytes:3,data:'AQID'}});await bad;assert.equal(blobs,1);
 console.log('Video privado: ACL, restricciones, carpeta, tamaño, identidad, respuestas obsoletas y liberación de memoria: OK');
})();
