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
assert.match(html, /media-src 'self' blob:;/, 'El navegador debe admitir el Blob autenticado como video');
let resolveRpc,blobs=0,revoked=0;
const ui=vm.createContext({console,Blob,Uint8Array,atob,document:{querySelector:()=>null},URL:{createObjectURL:()=>{blobs++;return 'blob:test'},revokeObjectURL:()=>revoked++},
 ensureSharedPendingClient:()=>({rpc:()=>new Promise(r=>resolveRpc=r)}),getSuiteAccessSession:()=>true,
 adsCurrentMonth:()=>({anuncios:[{creativo:{archivoId:'test'}}]}),adsModule(){},state:{active:'ads'}});
vm.runInContext(html.slice(html.indexOf('      let adsPlaying ='),html.indexOf('      function adsBrandList')),ui);
(async()=>{
 const stale=ui.adsPlayPrivate(0);ui.adsResetViewState();resolveRpc({data:{ok:true,id:'test',mime:'video/mp4',bytes:3,total:3,offset:0,version:'7',data:'AQID'}});await stale;assert.equal(blobs,0);
 const good=ui.adsPlayPrivate(0);resolveRpc({data:{ok:true,id:'test',mime:'video/mp4',bytes:3,total:3,offset:0,version:'7',data:'AQID'}});await good;assert.equal(blobs,1);ui.adsResetViewState();assert.equal(revoked,1);
 const bad=ui.adsPlayPrivate(0);resolveRpc({data:{ok:true,id:'other',mime:'video/mp4',bytes:3,total:3,offset:0,version:'7',data:'AQID'}});await bad;assert.equal(blobs,1);
 const chunkBytes=8*1024*1024, chunkData=Buffer.alloc(chunkBytes,1).toString('base64');
 const multi=ui.adsPlayPrivate(0);
 resolveRpc({data:{ok:true,id:'test',mime:'video/mp4',bytes:chunkBytes,total:chunkBytes+3,offset:0,version:'7',data:chunkData}});
 await new Promise(setImmediate);
 resolveRpc({data:{ok:true,id:'test',mime:'video/mp4',bytes:3,total:chunkBytes+3,offset:chunkBytes,version:'7',data:'AQID'}});
 await multi;assert.equal(blobs,2);ui.adsResetViewState();
 const changed=ui.adsPlayPrivate(0);
 resolveRpc({data:{ok:true,id:'test',mime:'video/mp4',bytes:chunkBytes,total:chunkBytes+3,offset:0,version:'7',data:chunkData}});
 await new Promise(setImmediate);
 resolveRpc({data:{ok:true,id:'test',mime:'video/mp4',bytes:3,total:chunkBytes+3,offset:chunkBytes,version:'8',data:'AQID'}});
 await changed;assert.equal(blobs,2);
 console.log('Video privado: ACL, restricciones, carpeta, tamaño, identidad, respuestas obsoletas y liberación de memoria: OK');
})();

// Real chunk reader: rejects unexpected ranges, changed revisions and revoked ACLs before returning bytes.
role='owner'; trashed=false; within=true; size=3; restricted=false;
let status=206, range='bytes 0-2/3', afterVersion='7', mediaReads=0;
ctx.UrlFetchApp.fetch=(url)=>{
 if(url.includes('alt=media')) {mediaReads++; return {getResponseCode:()=>status,getAllHeaders:()=>({'Content-Range':range}),getContent:()=>[1,2,3]};}
 return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(url.includes('fields=version&') ? {version:afterVersion} : {id:'a'.repeat(24),mimeType:'video/mp4',size:3,version:'7',capabilities:{canDownload:true}})};
};
let chunkReq={...req,offset:0,version:null};
assert.equal(ctx.nexusReadVideoChunk(chunkReq).data,'AQID');
status=200;assert.equal(ctx.nexusReadVideoChunk(chunkReq).ok,false);status=206;
range='bytes 1-3/3';assert.equal(ctx.nexusReadVideoChunk(chunkReq).ok,false);range='bytes 0-2/3';
afterVersion='8';assert.equal(ctx.nexusReadVideoChunk(chunkReq).ok,false);afterVersion='7';
const beforeDenied=mediaReads;role='none';assert.equal(ctx.nexusReadVideoChunk(chunkReq).ok,false);assert.equal(mediaReads,beforeDenied);
role='owner';assert.equal(ctx.nexusReadVideoChunk({...chunkReq,offset:1}).ok,false);
assert.equal(ctx.nexusReadVideoChunk({...chunkReq,version:'8'}).ok,false);
console.log('Lectura por partes: rango, longitud, versi�n concurrente y ACL: OK');
