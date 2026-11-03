(function researchUI(){
"use strict";
const esc=s=>String(s??"").replace(/[&<>"']/g,k=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[k]));
const segments={retail_ecommerce:"Retail / e-commerce",servicios_leads:"Servicios / leads"},statuses={pendiente:"Pendiente",requiere_revision:"Requiere revisión",validado:"Validado",rechazado:"Rechazado"},verification={sin_evidencia:"Sin evidencia",parcial:"Parcial",documentada:"Documentada"};
const priority=s=>Number(s)>=75?"Alta":Number(s)>=50?"Media":"Baja";
const options=(arr,selected)=>arr.map(([v,l])=>'<option value="'+esc(v)+'"'+(v===selected?" selected":"")+'>'+esc(l)+'</option>').join("");
const link=(u,l)=>{try{const p=new URL(u);return ["https:","http:"].includes(p.protocol)&&!p.username&&!p.password?'<a target="_blank" rel="noopener noreferrer" href="'+esc(p.href)+'">'+esc(l)+'</a>':"";}catch{return "";}};
let root=null,client=null,tab="search",loaded=false,busy=false,error="",notice="",doc=null,issues=null,outcome=null;
const data={candidates:[],companies:[],people:[],links:[],evidence:[],batches:[],sweeps:[]};
const filters={segment:"todos",priority:"todos",state:"todos",verify:"todos"};
let searchSegment="retail_ecommerce",searchKeyword="",searchDoc=null,searching=false,searchStats=null,searchSummary="";
let captureActive=false,captureVerified=false,captureJson="",captureFields={nombre:"",apellido:"",empresa:"",cargo:"",ubicacion:"",linkedin_url:"",web_empresa:""};
function clear(){client=null;loaded=false;for(const k in data)data[k]=[];doc=null;outcome=null;searchDoc=null;searchStats=null;searchSummary="";captureActive=false;captureVerified=false;captureJson="";captureFields={nombre:"",apellido:"",empresa:"",cargo:"",ubicacion:"",linkedin_url:"",web_empresa:""};}
function card(c,companies,people,links){
const co=companies.get(c.empresa_id),p=people.get(c.persona_id),v=links.get(c.vinculo_id),ev=data.evidence.filter(x=>x.candidato_id===c.id),display=[p?.nombre,p?.apellido].filter(Boolean).join(" ")||"Responsable no identificado", breakdown=Object.entries(c.desglose||{}).map(([k,x])=>esc(k)+": "+Number(x.points||0)+"/"+Number(x.max||0)+(x.unknown?" (desconocido)":"")).join(" · ");
return '<article class="research-card"><div class="research-head"><div><span class="research-muted">'+esc(segments[co?.segmento]||"Sin segmento")+'</span><h3>'+esc(co?.nombre||"Empresa sin identificar")+'</h3><div class="research-muted">'+esc(display)+(v?.cargo?" · "+esc(v.cargo):"")+'</div></div><div class="research-score">'+Number(c.afinidad||0)+'/100<div class="research-muted">Afinidad '+priority(c.afinidad)+'</div></div></div>'+
'<div class="research-meta"><span class="research-badge">'+esc(statuses[c.estado]||c.estado)+'</span><span class="research-badge">'+esc(verification[c.verificacion]||c.verificacion)+'</span>'+(co?.posible_duplicado_de?'<span class="research-badge">Coincidencia por revisar</span>':"")+link(co?.web,"Sitio web")+link(co?.linkedin_url,"LinkedIn empresa")+link(p?.linkedin_url,"LinkedIn persona")+'</div>'+
'<details><summary>Ver '+ev.length+' evidencias y desglose</summary><p class="research-muted">'+breakdown+'</p>'+(ev.length?ev.map(x=>'<div class="research-proof"><b>'+esc(x.dimension)+" · "+esc(x.campo)+'</b> — '+esc(x.hecho)+'<div>'+link(x.url,"Fuente exacta")+' · '+esc(x.consultado_en)+'</div></div>').join(""):'<p>Sin evidencias registradas.</p>')+'</details>'+
'<div class="research-actions"><label>Revisión<select data-status="'+esc(c.id)+'">'+options(Object.entries(statuses),c.estado)+'</select></label><label>Notas<input data-note="'+esc(c.id)+'" maxlength="2000" value="'+esc(c.notas_revision||"")+'"></label><button class="action" data-review="'+esc(c.id)+'">Guardar revisión</button><button class="action" data-confirm="'+esc(c.id)+'"'+(c.estado!=="validado"||c.verificacion==="documentada"||c.prospecto_id?" disabled":"")+'>Confirmar responsable</button><button class="action primary" data-promote="'+esc(c.id)+'"'+(c.estado!=="validado"||c.verificacion!=="documentada"||c.prospecto_id?" disabled":"")+'>'+(c.prospecto_id?"Ya promovido":"Promover")+'</button></div></article>';
}
function inbox(){
const companies=new Map(data.companies.map(x=>[x.id,x])),people=new Map(data.people.map(x=>[x.id,x])),links=new Map(data.links.map(x=>[x.id,x]));
const trackedBatches=new Set(data.batches.filter(x=>x.procedencia==="linkedin-peru-chrome").map(x=>x.id));
const linkedInCandidates=data.candidates.filter(x=>trackedBatches.has(x.lote_id)&&people.get(x.persona_id)?.linkedin_url);
const display=linkedInCandidates.filter(x=>{const co=companies.get(x.empresa_id);return (filters.segment==="todos"||co?.segmento===filters.segment)&&(filters.priority==="todos"||priority(x.afinidad).toLowerCase()===filters.priority)&&(filters.state==="todos"||x.estado===filters.state)&&(filters.verify==="todos"||x.verificacion===filters.verify);});
const metrics=[["Perfiles LinkedIn",linkedInCandidates.length],["Alta afinidad",linkedInCandidates.filter(x=>x.afinidad>=75).length],["Por revisar",linkedInCandidates.filter(x=>["pendiente","requiere_revision"].includes(x.estado)).length],["Validados",linkedInCandidates.filter(x=>x.estado==="validado").length]];
return '<div class="research-metrics">'+metrics.map(([n,v])=>'<div><strong>'+v+'</strong><span class="research-muted">'+n+'</span></div>').join("")+'</div><div class="research-filters">'+[
["segment","Segmento",segments],["priority","Prioridad",{alta:"Alta",media:"Media",baja:"Baja"}],["state","Investigación",statuses],["verify","Verificación",verification]
].map(([k,l,values])=>'<label>'+l+'<select data-filter="'+k+'">'+options([["todos","Todos"],...Object.entries(values)],filters[k])+'</select></label>').join("")+'</div><p class="research-muted">La afinidad no equivale a presupuesto confirmado. Los datos desconocidos no suman puntos.</p>'+(loaded?(display.length?display.map(x=>card(x,companies,people,links)).join(""):'<p class="research-muted">No hay perfiles capturados. Usa «Iniciar captura con ChatGPT».</p>'):'<p>Cargando datos de Prospección…</p>');
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


function captureSearchUrl(){
 const term=searchSegment==="retail_ecommerce"?"gerente marketing ecommerce retail Perú":"gerente comercial servicios Perú";
 return "https://www.linkedin.com/search/results/people/?keywords="+encodeURIComponent(term);
}
function captureInstructions(){
 return "Trabaja únicamente con las pestañas de LinkedIn que yo autorice en Chrome. "+
 "Ayúdame a registrar perfiles profesionales visibles de personas ubicadas en Perú, priorizando gerentes generales, comerciales, marketing y e-commerce del segmento "+(segments[searchSegment]||"seleccionado")+". "+
 "NO recorras perfiles masivamente, no eludas restricciones de LinkedIn, no envíes mensajes o invitaciones y no inventes datos. "+
 "De cada perfil que haya sido revisado explícitamente, prepara un arreglo JSON con: nombre, apellido, empresa, cargo, ubicacion (debe incluir Perú), segmento ("+searchSegment+"), linkedin_url (https://www.linkedin.com/in/...), web_empresa (opcional). "+
 "Devuelve solo registros con URL exacta de LinkedIn y evidencia visible. "+
 "Pega el arreglo en el campo 'Perfiles preparados con ChatGPT' de LR Suite para revisarlo y guardarlo en la base compartida. "+
 "Si no puedes comprobar un dato, no lo completes ni incluyas ese perfil.";
}
function startCapture(){
 if(busy||!client)return;
 captureActive=true;error="";notice="Captura iniciada. Revisa perfiles públicos en LinkedIn y, si utilizas ChatGPT en Chrome, autoriza las pestañas correspondientes.";
 window.open(captureSearchUrl(),"_blank","noopener,noreferrer");
 render();
}
async function copyCaptureInstructions(){
 try{
  if(!navigator.clipboard?.writeText)throw Error("Sin portapapeles");
  await navigator.clipboard.writeText(captureInstructions());
  notice="Instrucciones copiadas. Activa ChatGPT en Chrome y pégalas en tu conversación.";
 }catch{
  window.prompt("Copia estas instrucciones para ChatGPT:",captureInstructions());
  notice="Puedes copiar las instrucciones del cuadro anterior.";
 }
 render();
}
async function saveLinkedinCapture(){
 if(busy||!client)return;
 if(!captureVerified){error="Debes confirmar que revisaste los perfiles visibles de LinkedIn con ubicación Perú.";render();return;}
 let entries=[];
 try{
  if(captureJson.trim()){
   const parsed=JSON.parse(captureJson);
   entries=Array.isArray(parsed)?parsed:Array.isArray(parsed?.perfiles)?parsed.perfiles:[];
   if(!entries.length)throw Error("El JSON debe ser un arreglo de perfiles o contener una clave perfiles.");
  }else entries=[{...captureFields,segmento:searchSegment}];
  if(entries.length>25)throw Error("Carga hasta 25 perfiles por lote para revisar los resultados.");
  if(entries.some(x=>!x||typeof x!=="object"||Array.isArray(x)))throw Error("Uno de los perfiles tiene formato inválido.");
 }catch(e){error=String(e.message||e);render();return;}
 busy=true;error="";notice="";render();
 let created=0,duplicated=0,failures=[];
 try{
  for(let i=0;i<entries.length;i++){
   const candidate={...entries[i],segmento:entries[i].segmento||searchSegment,revisado_en_navegador:true};
   const response=await client.rpc("lr_pros_registrar_linkedin_peru",{p_registro:candidate});
   if(response.error){failures.push("Fila "+(i+1)+": "+response.error.message);continue;}
   if(response.data?.status==="created")created++;
   else if(response.data?.status==="already_exists")duplicated++;
   else failures.push("Fila "+(i+1)+": respuesta no reconocida.");
  }
  if(!failures.length){
   captureJson="";
   captureFields={nombre:"",apellido:"",empresa:"",cargo:"",ubicacion:"",linkedin_url:"",web_empresa:""};
   captureVerified=false;
  }
  notice="Base compartida actualizada: "+created+" perfil(es) nuevo(s), "+duplicated+" ya registrado(s).";
  if(failures.length)error=failures.length+" registro(s) requieren corrección. "+failures.slice(0,2).join(" | ");
 }catch(e){error="No fue posible registrar los perfiles: "+String(e.message||e);}
 finally{busy=false;await load();render();}
}
function searchView(){
 const authorizedBatchIds=new Set(data.batches.filter(x=>x.procedencia==="linkedin-peru-chrome").map(x=>x.id));
 const num=data.candidates.filter(x=>authorizedBatchIds.has(x.lote_id)).length;
 const fields=[
 ["nombre","Nombre"],["apellido","Apellido"],["empresa","Empresa"],["cargo","Cargo actual (visible)"],
 ["ubicacion","Ubicación tal como aparece en el perfil (debe incluir Perú)"],
 ["linkedin_url","URL exacta LinkedIn (/in/)"],["web_empresa","Sitio web corporativo (opcional)"]
 ];
 return '<h3>Captura de perfiles · LinkedIn Perú</h3>'+
 '<p class="research-muted">Solo perfiles profesionales con URL LinkedIn y ubicación Perú. Datos compartidos entre las cuentas autorizadas de LR Suite. Sin mensajes ni invitaciones automáticas.</p>'+
 '<div class="research-metrics"><div><strong>'+num+'</strong><span class="research-muted">Perfiles capturados</span></div>'+
 '<div><strong>Perú</strong><span class="research-muted">Ubicación requerida</span></div></div>'+
 '<div class="research-capture-intro"><div><b>Iniciar investigación asistida</b>'+
 '<p class="research-muted">El botón abre LinkedIn en una nueva pestaña y habilita la captura. ChatGPT en Chrome debe activarse desde su extensión; una página web no puede ejecutarla directamente.</p></div>'+
 '<div class="research-actions" style="border:0;margin:0;padding:0"><button class="action primary" data-start-capture'+(busy?" disabled":"")+'>Iniciar captura con ChatGPT</button></div></div>'+
 (captureActive?'<div class="research-capture-panel">'+
 '<h3>Registrar perfiles revisados</h3>'+
 '<div class="research-capture-tools"><button class="action" data-open-linkedin>Abrir búsqueda en LinkedIn</button>'+
 '<button class="action" data-copy-chrome>Copiar instrucciones para ChatGPT</button></div>'+
 '<div class="research-capture-grid"><label>Segmento<select id="captureSegment">'+options(Object.entries(segments),searchSegment)+'</select></label>'+
 fields.map(([k,l])=>'<label'+(k==="linkedin_url"||k==="ubicacion"?' class="research-field-wide"':"")+'>'+l+
 '<input data-capture-field="'+k+'" maxlength="'+(k==="linkedin_url"?"500":"200")+'" value="'+esc(captureFields[k]||"")+'" placeholder="'+
 esc(k==="linkedin_url"?"https://www.linkedin.com/in/perfil":k==="ubicacion"?"Lima, Perú":"")+'"></label>').join("")+'</div>'+
 '<details class="research-capture-bulk"><summary>Perfiles preparados con ChatGPT (JSON)</summary>'+
 '<p class="research-muted">Pega un arreglo JSON de hasta 25 perfiles con los mismos campos del formulario. Se registran individualmente; los duplicados no se vuelven a crear.</p>'+
 '<textarea id="captureJson" rows="7" spellcheck="false" placeholder=\'[{"nombre":"...","apellido":"...","empresa":"...","cargo":"...","ubicacion":"Lima, Perú","segmento":"retail_ecommerce","linkedin_url":"https://www.linkedin.com/in/..."}]\'>'+esc(captureJson)+'</textarea></details>'+
 '<label class="research-capture-consent"><input id="captureVerified" type="checkbox"'+(captureVerified?" checked":"")+'> Confirmo que revisé los perfiles visibles y su ubicación Perú. Los cargos quedan pendientes de validación.</label>'+
 '<div class="research-actions"><button class="action primary" data-save-linkedin'+(busy?" disabled":"")+'>Registrar en base compartida</button><button class="action" data-finish-capture>Terminar captura</button></div>'+
 '</div>':'')+
 '<p class="research-muted">Si otra persona del equipo registra el mismo perfil, el sistema detecta la URL canónica y no crea una segunda ficha.</p>';
}
function importer(){
return '<h3>Importar lote de investigación</h3><p class="research-muted">Archivo JSON V1 · hasta 100 candidatos. No envía mensajes ni modifica seguimiento comercial.</p><input id="rFile" type="file" accept=".json,application/json">'+
(doc?'<p>Lote: <b>'+esc(doc.batch_id)+'</b> · '+esc(doc.source)+'</p><div class="research-table"><table><thead><tr><th>ID</th><th>Empresa</th><th>Validación</th></tr></thead><tbody>'+(doc.candidates||[]).map((x,i)=>'<tr><td>'+esc(x.external_id)+'</td><td>'+esc(x.company?.name)+'</td><td>'+esc(issues.rows[i]?.join("; ")||"Estructura correcta")+'</td></tr>').join("")+'</tbody></table></div>'+(issues.fatal.length?'<p class="research-muted">'+esc(issues.fatal.join("; "))+'</p>':"")+'<div class="research-actions"><button class="action primary" data-import'+(!issues.valid||busy?" disabled":"")+'>Importar a bandeja</button><button class="action" data-clear>Limpiar</button></div>':"")+
(outcome?'<h3 style="margin-top:20px">Resultado del lote '+(outcome.reimported?"(reimportado)":"")+'</h3><div class="research-table"><table><thead><tr><th>ID</th><th>Resultado</th><th>Detalles</th></tr></thead><tbody>'+(outcome.results||[]).map(x=>'<tr><td>'+esc(x.external_id)+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.message||"")+'</td></tr>').join("")+'</tbody></table></div>':"");
}
function history(){return '<h3>Historial de capturas LinkedIn Perú</h3><div class="research-table"><table><thead><tr><th>Fecha</th><th>Procedencia</th><th>Lote</th><th>Estado</th><th>Resultados</th></tr></thead><tbody>'+data.batches.filter(x=>x.procedencia==='linkedin-peru-chrome').map(x=>'<tr><td>'+esc(x.creado_en)+'</td><td>'+esc(x.procedencia)+'</td><td>'+esc(x.clave)+'</td><td>'+esc(x.estado)+'</td><td>'+(x.resultados?.length||0)+'</td></tr>').join("")+'</tbody></table></div>';}
function render(){
if(!root||!root.isConnected)return;
root.innerHTML='<section class="panel"><nav class="research-tabs"><button data-tab="search" class="'+(tab==="search"?"sel":"")+'">Captura LinkedIn Perú</button><button data-tab="inbox" class="'+(tab==="inbox"?"sel":"")+'">Bandeja de investigación</button><button data-tab="history" class="'+(tab==="history"?"sel":"")+'">Historial</button><button data-refresh style="margin-left:auto">Actualizar</button></nav>'+(error?'<div class="research-msg err">'+esc(error)+'</div>':"")+(notice?'<div class="research-msg">'+esc(notice)+'</div>':"")+'<div class="research-body">'+(tab==="search"?searchView():tab==="inbox"?inbox():history())+'</div></section>';
root.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{tab=b.dataset.tab;render();}));root.querySelector("[data-refresh]")?.addEventListener("click",load);
root.querySelectorAll("[data-filter]").forEach(x=>x.addEventListener("change",()=>{filters[x.dataset.filter]=x.value;render();}));
root.querySelectorAll("[data-review]").forEach(x=>x.addEventListener("click",()=>review(x.dataset.review)));root.querySelectorAll("[data-promote]").forEach(x=>x.addEventListener("click",()=>promote(x.dataset.promote)));root.querySelectorAll("[data-confirm]").forEach(x=>x.addEventListener("click",()=>confirmResponsible(x.dataset.confirm)));
root.querySelector("#searchSegment")?.addEventListener("change",e=>{searchSegment=e.target.value;});
root.querySelector("#searchKeyword")?.addEventListener("input",e=>{searchKeyword=e.target.value;});
root.querySelector("[data-start-capture]")?.addEventListener("click",startCapture);
root.querySelector("[data-open-linkedin]")?.addEventListener("click",()=>window.open(captureSearchUrl(),"_blank","noopener,noreferrer"));
root.querySelector("[data-copy-chrome]")?.addEventListener("click",copyCaptureInstructions);
root.querySelector("[data-save-linkedin]")?.addEventListener("click",saveLinkedinCapture);
root.querySelector("[data-finish-capture]")?.addEventListener("click",()=>{captureActive=false;render();});
root.querySelector("#captureSegment")?.addEventListener("change",e=>{searchSegment=e.target.value;render();});
root.querySelectorAll("[data-capture-field]").forEach(x=>x.addEventListener("input",()=>{captureFields[x.dataset.captureField]=x.value;}));
root.querySelector("#captureJson")?.addEventListener("input",e=>{captureJson=e.target.value;});
root.querySelector("#captureVerified")?.addEventListener("change",e=>{captureVerified=e.target.checked;});

root.querySelector("#rFile")?.addEventListener("change",async ev=>{try{const f=ev.target.files?.[0];if(!f)return;if(f.size>2*1024*1024)throw Error("Límite: 2 MB");doc=JSON.parse(await f.text());issues=validate(doc);error="";outcome=null;}catch(e){doc=null;error=e.message;}render();});
root.querySelector("[data-import]")?.addEventListener("click",sendImport);root.querySelector("[data-clear]")?.addEventListener("click",()=>{doc=null;issues=null;outcome=null;render();});
}
async function load(){if(!client||busy)return;busy=true;error="";render();try{const entries=[["lr_pros_candidatos","candidates"],["lr_pros_empresas","companies"],["lr_pros_personas","people"],["lr_pros_vinculos","links"],["lr_pros_evidencias","evidence"],["lr_pros_lotes","batches"],["lr_pros_barridos","sweeps"]];const rs=await Promise.all(entries.map(async ([t,k])=>{const r=await client.from(t).select("*").limit(1000);if(r.error)throw Error(t+": "+r.error.message);return [k,r.data||[]];}));for(const [k,v]of rs)data[k]=v;data.candidates.sort((a,b)=>b.afinidad-a.afinidad);data.batches.sort((a,b)=>new Date(b.creado_en)-new Date(a.creado_en));loaded=true;}catch(e){error="Error al consultar Investigación: "+e.message;loaded=false;}finally{busy=false;render();}}
async function rpc(method,params){if(busy||!client)return null;busy=true;error="";notice="";try{const r=await client.rpc(method,params);if(r.error)throw Error(r.error.message);return r.data;}catch(e){error=e.message;return null;}finally{busy=false;render();}}

async function discover(){
 if(busy||!client)return;
 busy=true;error="";notice="";searchDoc=null;searchSummary="";render();
 let mustReload=false;
 try{
  const filter=searchKeyword.trim().toLowerCase();
  const progress=await client.rpc("lr_pros_barrido_estado",{p_segmento:searchSegment,p_consulta:filter});
  if(progress.error)throw new Error("No se pudo consultar avance: "+progress.error.message);
  const cursor=Number(progress.data?.cursor||0);
  const response=await client.functions.invoke("lr-pros-descubrir",{body:{segment:searchSegment,keyword:filter,cursor}});
  if(response.error){
   let detail="";
   const context=response.error.context;
   if(context?.json)try{const j=await context.json();detail=String(j?.error||"")}catch{}
   throw new Error(detail||response.error.message||"La fuente de búsqueda no está disponible");
  }
  if(response.data?.error)throw new Error(response.data.error);
  const found=response.data?.candidates||[];
  if(!Array.isArray(found))throw new Error("El servicio devolvió datos inválidos");
  searchDoc=response.data;
  let created=0,repeated=0;
  if(found.length){
   const batch={schema_version:response.data.schema_version,batch_id:response.data.batch_id,
      source:response.data.source,candidates:found};
   const result=await client.rpc("lr_pros_importar",{p_documento:batch});
   if(result.error)throw new Error("Error al registrar candidatos: "+result.error.message);
   const rows=result.data?.results||[];
   const failures=rows.filter(x=>x.status==="error");
   if(failures.length)throw new Error(failures.length+" candidatos no se pudieron guardar: "+String(failures[0]?.message||"error"));
   created=rows.filter(x=>x.status==="created").length;
   repeated=rows.length-created;
  }
  const advanced=await client.rpc("lr_pros_barrido_avanzar",{
   p_segmento:searchSegment,p_consulta:filter,p_cursor:cursor,
   p_siguiente:Number(response.data.next_cursor??cursor),p_nuevos:created
  });
  if(advanced.error)throw new Error("Guardamos resultados pero no el cursor: "+advanced.error.message);
  searchStats=advanced.data;
  searchSummary="Barrido terminado: "+Number(response.data.scanned||0)+" resultados examinados, "+
   created+" candidatos nuevos guardados"+(repeated?", "+repeated+" coincidencias repetidas":"")+".";
  notice=searchSummary;
  mustReload=true;
 }catch(e){error="Búsqueda no completada: "+String(e.message||e);}
 finally{busy=false;if(mustReload)await load();render();}
}
async function sendImport(){if(!doc||!issues?.valid)return;const r=await rpc("lr_pros_importar",{p_documento:doc});if(r){outcome=r;notice="Importación completada. Revisa los resultados por fila.";await load();tab="import";render();}}
async function review(id){const c=data.candidates.find(x=>x.id===id),state=root?.querySelector('[data-status="'+id+'"]')?.value,note=root?.querySelector('[data-note="'+id+'"]')?.value;if(!c||!state)return;const r=await rpc("lr_pros_revisar",{p_candidato:id,p_estado:state,p_notas:note||"",p_revision_anterior:c.revisado_en||null});if(r){notice="Revisión guardada";await load();}}
async function confirmResponsible(id){
 const candidate=data.candidates.find(x=>x.id===id);
 if(!candidate||candidate.estado!=="validado")return;
 const e=data.evidence.filter(x=>x.candidato_id===id&&(x.sujeto==="persona"||x.sujeto==="vinculo")&&x.dimension==="responsable");
 if(!e.length){error="Primero registre evidencia exacta del responsable.";render();return;}
 const source=window.prompt("Verifica el cargo en una fuente real y confirma su URL exacta:",e[0].url);
 if(!source)return;
 const note=window.prompt("Describe cómo verificaste nombre, empresa, cargo y vigencia (mínimo 20 caracteres):","");
 if(!note)return;
 const out=await rpc("lr_pros_confirmar_responsable",{p_candidato:id,p_fuente_url:source,p_nota:note});
 if(out){notice="Responsable confirmado. Ya puedes promoverlo al seguimiento.";await load();}
}
async function promote(id){if(!window.confirm("¿Promover este candidato validado al seguimiento comercial?"))return;const r=await rpc("lr_pros_promover",{p_candidato:id});if(r){notice=r.status==="promoted"?"Candidato agregado a Seguimiento comercial":r.status==="already_promoted"?"Ya promovido":"Contacto coincidente, requiere revisión";await load();}}
function mount(el,supabase){if(!el)return;if(!supabase){clear();el.innerHTML='<div class="panel" style="padding:18px">Inicia sesión para acceder a Investigación.</div>';return;}if(client!==supabase){clear();client=supabase;}root=el;render();if(!loaded&&!busy)load();}
function unmount(){root=null;}window.LRProspeccionInvestigacion={mount,unmount};
})();