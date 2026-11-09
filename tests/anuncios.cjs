const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ctx = vm.createContext({console});
vm.runInContext(fs.readFileSync('src/modules/anuncios/apps-script/Codigo.gs','utf8'),ctx);
let checks=0;
for (const currency of ['PEN','USD']) {
 const head=['Día','Nombre del anuncio',`Monto gastado (${currency})`,'Impresiones'];
 const groups={},ads=[];
 const days=ctx.acumular([head,['2026-11-01','Test',1.25,10]],'America/Lima',groups,ads,null);
 ctx.acumular([head,['2026-11-01','Test',1.25,10],['2026-11-02','Test',2.75,20]],'America/Lima',groups,ads,days);
 assert.equal(ads[0].gasto,4);assert.equal(ads[0].moneda,currency); checks+=2;
 const translated=ctx.traducirNexus([['NEXUS_META_V1','','',currency],['level','day','name','spend','reach','results','preview'],['campaign','2026-11-01','Test',999,1,1,''],['ad','2026-11-01','Test',3.25,10,2,'https://example.com/ad']]);
 const canon=[];ctx.acumular(translated.filas,'America/Lima',{},canon,null);
 assert.equal(canon.length,1);assert.equal(canon[0].gasto,3.25);assert.equal(canon[0].moneda,currency);assert.equal(canon[0].preview,'https://example.com/ad');checks+=4;
}
const groups={},mixed=[];ctx.acumular([['Día','Nombre del anuncio','Monto gastado (PEN)'],['2026-11-01','Test',1]],'',groups,mixed,null);
assert.throws(()=>ctx.acumular([['Día','Nombre del anuncio','Monto gastado (USD)'],['2026-11-02','Test',1]],'',groups,mixed,null),/mezcla monedas/);checks++;
const html=fs.readFileSync('index.html','utf8');
vm.runInContext(html.slice(html.indexOf('      function adsMoney('),html.indexOf('      function adsCardHtml(')),ctx);
assert.match(ctx.adsMoney(64.13,'USD'),/USD.*64.13/);assert.match(ctx.adsMoney(109.81,'PEN'),/S\/.*109.81/);checks+=2;
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if(match[1].trim()) new vm.Script(match[1]);
console.log(`${checks} comprobaciones correctas; JavaScript de producción válido.`);
const timerCallbacks=[];
const poll=vm.createContext({Date,window:{setTimeout(fn){timerCallbacks.push(fn);return timerCallbacks.length;}},getSuiteAccessSession:()=>true, state:{active:'ads'},render(){},adsPayload:{syncState:'queued'},adsSyncing:false,adsError:'',loadPrivateAds:async()=>{poll.adsPayload={marcas:[]};}});
vm.runInContext(html.slice(html.indexOf('      let adsPollTimer ='),html.indexOf('      async function syncAdsFromDrive()')),poll);
(async()=>{
 vm.runInContext('watchAdsSync(); watchAdsSync();',poll);
 assert.equal(timerCallbacks.length,1);assert.equal(poll.adsSyncing,true);
 await timerCallbacks[0]();assert.equal(poll.adsSyncing,false);
 poll.adsPayload={syncState:'queued'};
 vm.runInContext('watchAdsSync(); adsPollStarted = Date.now() - 11 * 60 * 1000;',poll);
 await timerCallbacks[1]();assert.equal(poll.adsSyncing,false);assert.match(poll.adsError,/pendiente/);
 console.log('5 comprobaciones de espera, deduplicación y fin de carga correctas.');
})();
