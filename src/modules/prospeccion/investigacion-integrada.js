(function researchUI(){
"use strict";
const esc=s=>String(s??"").replace(/[&<>"']/g,k=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[k]));
const segments={retail_ecommerce:"Retail / e-commerce",servicios_leads:"Servicios / leads"},statuses={pendiente:"Pendiente",requiere_revision:"Requiere revisión",validado:"Validado",rechazado:"Rechazado"},verification={sin_evidencia:"Sin evidencia",parcial:"Parcial",documentada:"Documentada"};
const priority=s=>Number(s)>=75?"Alta":Number(s)>=50?"Media":"Baja";
const options=(arr,selected)=>arr.map(([v,l])=>'<option value="'+esc(v)+'"'+(v===selected?" selected":"")+'>'+esc(l)+'</option>').join("");
const link=(u,l)=>{try{const p=new URL(u);return ["https:","http:"].includes(p.protocol)&&!p.username&&!p.password?'<a target="_blank" rel="noopener noreferrer" href="'+esc(p.href)+'">'+esc(l)+'</a>':"";}catch{return "";}};
let root=null,client=null,tab="search",loaded=false,busy=false,error="",notice="",doc=null,issues=null,outcome=null;
const data={candidates:[],companies:[],people:[],links:[],evidence:[],batches:[]};
const filters={segment:"todos",priority:"todos",state:"todos",verify:"todos"};
let searchSegment="retail_ecommerce",searchKeyword="",searchDoc=null,searching=false;
function clear(){client=null;loaded=false;for(const k in data)data[k]=[];doc=null;outcome=null;}
function card(c,companies,people,links){
const co=companies.get(c.empresa_id),p=people.get(c.persona_id),v=links.get(c.vinculo_id),ev=data.evidence.filter(x=>x.candidato_id===c.id),display=[p?.nombre,p?.apellido].filter(Boolean).join(" ")||"Responsable no identificado", breakdown=Object.entries(c.desglose||{}).map(([k,x])=>esc(k)+": "+Number(x.points||0)+"/"+Number(x.max||0)+(x.unknown?" (desconocido)":"")).join(" · ");
return '<article class="research-card"><div class="research-head"><div><span class="research-muted">'+esc(segments[co?.segmento]||"Sin segmento")+'</span><h3>'+esc(co?.nombre||"Empresa sin identificar")+'</h3><div class="research-muted">'+esc(display)+(v?.cargo?" · "+esc(v.cargo):"")+'</div></div><div class="research-score">'+Number(c.afinidad||0)+'/100<div class="research-muted">Afinidad '+priority(c.afinidad)+'</div></div></div>'+
'<div class="research-meta"><span class="research-badge">'+esc(statuses[c.estado]||c.estado)+'</span><span class="research-badge">'+esc(verification[c.verificacion]||c.verificacion)+'</span>'+(co?.posible_duplicado_de?'<span class="research-badge">Coincidencia por revisar</span>':"")+link(co?.web,"Sitio web")+link(co?.linkedin_url,"LinkedIn empresa")+link(p?.linkedin_url,"LinkedIn persona")+'</div>'+
'<details><summary>Ver '+ev.length+' evidencias y desglose</summary><p class="research-muted">'+breakdown+'</p>'+(ev.length?ev.map(x=>'<div class="research-proof"><b>'+esc(x.dimension)+" · "+esc(x.campo)+'</b> — '+esc(x.hecho)+'<div>'+link(x.url,"Fuente exacta")+' · '+esc(x.consultado_en)+'</div></div>').join(""):'<p>Sin evidencias registradas.</p>')+'</details>'+
'<div class="research-actions"><label>Revisión<select data-status="'+esc(c.id)+'">'+options(Object.entries(statuses),c.estado)+'</select></label><label>Notas<input data-note="'+esc(c.id)+'" maxlength="2000" value="'+esc(c.notas_revision||"")+'"></label><button class="action" data-review="'+esc(c.id)+'">Guardar revisión</button><button class="action primary" data-promote="'+esc(c.id)+'"'+(c.estado!=="validado"||c.prospecto_id?" disabled":"")+'>'+(c.prospecto_id?"Ya promovido":"Promover")+'</button></div></article>';
}
function inbox(){
const companies=new Map(data.companies.map(x=>[x.id,x])),people=new Map(data.people.map(x=>[x.id,x])),links=new Map(data.links.map(x=>[x.id,x]));
const display=data.candidates.filter(x=>{const co=companies.get(x.empresa_id);return (filters.segment==="todos"||co?.segmento===filters.segment)&&(filters.priority==="todos"||priority(x.afinidad).toLowerCase()===filters.priority)&&(filters.state==="todos"||x.estado===filters.state)&&(filters.verify==="todos"||x.verificacion===filters.verify);});
const metrics=[["Candidatos",data.candidates.length],["Alta afinidad",data.candidates.filter(x=>x.afinidad>=75).length],["Por revisar",data.candidates.filter(x=>["pendiente","requiere_revision"].includes(x.estado)).length],["Validados",data.candidates.filter(x=>x.estado==="validado").length]];
return '<div class="research-metrics">'+metrics.map(([n,v])=>'<div><strong>'+v+'</strong><span class="research-muted">'+n+'</span></div>').join("")+'</div><div class="research-filters">'+[
["segment","Segmento",segments],["priority","Prioridad",{alta:"Alta",media:"Media",baja:"Baja"}],["state","Investigación",statuses],["verify","Verificación",verification]
].map(([k,l,values])=>'<label>'+l+'<select data-filter="'+k+'">'+options([["todos","Todos"],...Object.entries(values)],filters[k])+'</select></label>').join("")+'</div><p class="research-muted">La afinidad no equivale a presupuesto confirmado. Los datos desconocidos no suman puntos.</p>'+(loaded?(display.length?display.map(x=>card(x,companies,people,links)).join(""):'<p class="research-muted">No hay candidatos. Comienza en «Importar lote».</p>'):'<p>Cargando datos de staging…</p>');
}
function validate(d){
const fatal=[],rows=[],seen=new Set();
if(!d||d.schema_version!=="1.0")fatal.push("schema_version debe ser 1.0");
if(typeof d?.batch_id!=="string"||!d.batch_id.trim()||d.batch_id.length>120)fatal.push("batch_id inválido");
if(typeof d?.source!=="string"||!d.source.trim()||d.source.length>120)fatal.push("source inválido");
if(!Array.isArray(d?.candidates)||!d.candidates.length||d.candidates.length>100)fatal.push("candidates requiere 1 a 100 elementos");
for(const c of d?.candidates||[]){const e=[];if(typeof c?.external_id!=="string"||!c.external_id||c.external_id.length>120)e.push("external_id inválido");if(seen.has(c?.external_id))e.push("ID repetido");seen.add(c?.external_id);if(!c?.company?.name||!segments[c.company.segment])e.push("Empresa o segmento inválidos");if(c?.evidence!=null&&!Array.isArray(c.evidence))e.push("Evidencias deben ser arreglo");if(Array.isArray(c?.evidence))for(const v of c.evidence){try{const u=new URL(v.url);if(u.protocol!=="https:"||!v.ref||!v.field||!v.fact||!v.checked_at)e.push("Evidencia incompleta");}catch{e.push("URL de evidencia inválida");}}rows.push(e);}
return {fatal,rows,valid:!fatal.length&&rows.every(x=>!x.length)};
}

function searchView(){
  const candidates=searchDoc?.candidates||[];
  return '<h3>Buscar empresas y responsables comerciales</h3>'+
  '<p class="research-muted">Búsqueda pública inicial en Perú. Fuente: Wikidata. No consulta LinkedIn automáticamente; sus datos requieren revisión.</p>'+
  '<div class="research-filters" style="grid-template-columns:1fr 1fr auto;align-items:end"><label>Segmento<select id="searchSegment">'+options(Object.entries(segments),searchSegment)+'</select></label>'+
  '<label>Rubro o palabra clave (opcional)<input id="searchKeyword" maxlength="70" value="'+esc(searchKeyword)+'" placeholder="moda, consultoría, tecnología..."></label>'+
  '<button class="action primary" data-search '+(busy?'disabled':'')+'>'+(busy?'Buscando…':'Buscar 5 empresas')+'</button></div>'+
  '<p class="research-muted">Para gerentes, se muestra solamente un nombre citado por la fuente. No se inventan perfiles ni correos de LinkedIn.</p>'+
  (searchDoc?'<h3 style="margin-top:15px">Encontrados: '+candidates.length+'</h3>'+
  '<p class="research-muted">'+esc(searchDoc.notice||'')+'</p>'+
  (candidates.length?'<div class="research-table"><table><thead><tr><th>Empresa</th><th>Responsable citado</th><th>Fuente</th></tr></thead><tbody>'+
   candidates.map(c=>'<tr><td><strong>'+esc(c.company?.name)+'</strong><div>'+link(c.company?.website,'Sitio web')+'</div></td><td>'+esc(c.person?.first_name||'Pendiente de identificar')+'</td><td>'+link(c.evidence?.[0]?.url,'Wikidata')+'</td></tr>').join('')+'</tbody></table></div>'+
  '<div class="research-actions"><button class="action primary" data-accept'+(busy?' disabled':'')+'>Registrar en Investigación</button></div>':
  '<p>No hubo coincidencias clasificadas para este segmento en la fuente inicial. Ampliaremos a búsqueda web al conectar el proveedor.</p>'):'');
}
function importer(){
return '<h3>Importar lote de investigación</h3><p class="research-muted">Archivo JSON V1 · hasta 100 candidatos. No envía mensajes ni modifica seguimiento comercial.</p><input id="rFile" type="file" accept=".json,application/json">'+
(doc?'<p>Lote: <b>'+esc(doc.batch_id)+'</b> · '+esc(doc.source)+'</p><div class="research-table"><table><thead><tr><th>ID</th><th>Empresa</th><th>Validación</th></tr></thead><tbody>'+(doc.candidates||[]).map((x,i)=>'<tr><td>'+esc(x.external_id)+'</td><td>'+esc(x.company?.name)+'</td><td>'+esc(issues.rows[i]?.join("; ")||"Estructura correcta")+'</td></tr>').join("")+'</tbody></table></div>'+(issues.fatal.length?'<p class="research-muted">'+esc(issues.fatal.join("; "))+'</p>':"")+'<div class="research-actions"><button class="action primary" data-import'+(!issues.valid||busy?" disabled":"")+'>Importar a bandeja</button><button class="action" data-clear>Limpiar</button></div>':"")+
(outcome?'<h3 style="margin-top:20px">Resultado del lote '+(outcome.reimported?"(reimportado)":"")+'</h3><div class="research-table"><table><thead><tr><th>ID</th><th>Resultado</th><th>Detalles</th></tr></thead><tbody>'+(outcome.results||[]).map(x=>'<tr><td>'+esc(x.external_id)+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.message||"")+'</td></tr>').join("")+'</tbody></table></div>':"");
}
function history(){return '<h3>Historial de importaciones</h3><div class="research-table"><table><thead><tr><th>Fecha</th><th>Procedencia</th><th>Lote</th><th>Estado</th><th>Resultados</th></tr></thead><tbody>'+data.batches.map(x=>'<tr><td>'+esc(x.creado_en)+'</td><td>'+esc(x.procedencia)+'</td><td>'+esc(x.clave)+'</td><td>'+esc(x.estado)+'</td><td>'+(x.resultados?.length||0)+'</td></tr>').join("")+'</tbody></table></div>';}
function render(){
if(!root||!root.isConnected)return;
root.innerHTML='<section class="panel"><nav class="research-tabs"><button data-tab="search" class="'+(tab==="search"?"sel":"")+'">Buscar posibles clientes</button><button data-tab="inbox" class="'+(tab==="inbox"?"sel":"")+'">Bandeja de investigación</button><button data-tab="import" class="'+(tab==="import"?"sel":"")+'">Importar lote</button><button data-tab="history" class="'+(tab==="history"?"sel":"")+'">Historial</button><button data-refresh style="margin-left:auto">Actualizar</button></nav>'+(error?'<div class="research-msg err">'+esc(error)+'</div>':"")+(notice?'<div class="research-msg">'+esc(notice)+'</div>':"")+'<div class="research-body">'+(tab==="search"?searchView():tab==="inbox"?inbox():tab==="import"?importer():history())+'</div></section>';
root.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{tab=b.dataset.tab;render();}));root.querySelector("[data-refresh]")?.addEventListener("click",load);
root.querySelectorAll("[data-filter]").forEach(x=>x.addEventListener("change",()=>{filters[x.dataset.filter]=x.value;render();}));
root.querySelectorAll("[data-review]").forEach(x=>x.addEventListener("click",()=>review(x.dataset.review)));root.querySelectorAll("[data-promote]").forEach(x=>x.addEventListener("click",()=>promote(x.dataset.promote)));
root.querySelector("#searchSegment")?.addEventListener("change",e=>{searchSegment=e.target.value;});
root.querySelector("#searchKeyword")?.addEventListener("input",e=>{searchKeyword=e.target.value;});
root.querySelector("[data-search]")?.addEventListener("click",discover);
root.querySelector("[data-accept]")?.addEventListener("click",acceptResults);
root.querySelector("#rFile")?.addEventListener("change",async ev=>{try{const f=ev.target.files?.[0];if(!f)return;if(f.size>2*1024*1024)throw Error("Límite: 2 MB");doc=JSON.parse(await f.text());issues=validate(doc);error="";outcome=null;}catch(e){doc=null;error=e.message;}render();});
root.querySelector("[data-import]")?.addEventListener("click",sendImport);root.querySelector("[data-clear]")?.addEventListener("click",()=>{doc=null;issues=null;outcome=null;render();});
}
async function load(){if(!client||busy)return;busy=true;error="";render();try{const entries=[["lr_pros_candidatos","candidates"],["lr_pros_empresas","companies"],["lr_pros_personas","people"],["lr_pros_vinculos","links"],["lr_pros_evidencias","evidence"],["lr_pros_lotes","batches"]];const rs=await Promise.all(entries.map(async ([t,k])=>{const r=await client.from(t).select("*").limit(1000);if(r.error)throw Error(t+": "+r.error.message);return [k,r.data||[]];}));for(const [k,v]of rs)data[k]=v;data.candidates.sort((a,b)=>b.afinidad-a.afinidad);data.batches.sort((a,b)=>new Date(b.creado_en)-new Date(a.creado_en));loaded=true;}catch(e){error="Error al consultar Investigación en staging: "+e.message;loaded=false;}finally{busy=false;render();}}
async function rpc(method,params){if(busy||!client)return null;busy=true;error="";notice="";try{const r=await client.rpc(method,params);if(r.error)throw Error(r.error.message);return r.data;}catch(e){error=e.message;return null;}finally{busy=false;render();}}

async function discover(){
 if(busy||!client)return;
 busy=true;error="";notice="";searchDoc=null;render();
 try{
  const response=await client.functions.invoke("lr-pros-descubrir",{body:{segment:searchSegment,keyword:searchKeyword}});
  if(response.error)throw new Error(response.error.message||"Fuente no disponible");
  if(response.data?.error)throw new Error(response.data.error);
  searchDoc=response.data;notice="Búsqueda completada. Revisa antes de registrar.";
 }catch(e){error="No fue posible buscar empresas: "+e.message;}
 finally{busy=false;render();}
}
async function acceptResults(){
 if(!searchDoc?.candidates?.length)return;
 const result=await rpc("lr_pros_importar",{p_documento:{schema_version:searchDoc.schema_version,batch_id:searchDoc.batch_id,source:searchDoc.source,candidates:searchDoc.candidates}});
 if(result){notice="Resultados incorporados a Investigación (revisión pendiente).";searchDoc=null;await load();tab="inbox";render();}
}
async function sendImport(){if(!doc||!issues?.valid)return;const r=await rpc("lr_pros_importar",{p_documento:doc});if(r){outcome=r;notice="Importación completada. Revisa los resultados por fila.";await load();tab="import";render();}}
async function review(id){const c=data.candidates.find(x=>x.id===id),state=root?.querySelector('[data-status="'+id+'"]')?.value,note=root?.querySelector('[data-note="'+id+'"]')?.value;if(!c||!state)return;const r=await rpc("lr_pros_revisar",{p_candidato:id,p_estado:state,p_notas:note||"",p_revision_anterior:c.revisado_en||null});if(r){notice="Revisión guardada";await load();}}
async function promote(id){if(!window.confirm("¿Promover este candidato validado al seguimiento comercial?"))return;const r=await rpc("lr_pros_promover",{p_candidato:id});if(r){notice=r.status==="promoted"?"Candidato agregado a Seguimiento comercial":r.status==="already_promoted"?"Ya promovido":"Contacto coincidente, requiere revisión";await load();}}
function mount(el,supabase){if(!el)return;if(!supabase){clear();el.innerHTML='<div class="panel" style="padding:18px">Inicia sesión para acceder a Investigación.</div>';return;}if(client!==supabase){clear();client=supabase;}root=el;render();if(!loaded&&!busy)load();}
function unmount(){root=null;}window.LRProspeccionInvestigacion={mount,unmount};
})();