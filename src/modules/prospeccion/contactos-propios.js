(function(){
"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const canonical=u=>{
 const raw=String(u||"").trim();
 if(!raw)return "";
 try{
  const fixed=/^(www\.)?linkedin\.com\//i.test(raw)?"https://"+raw:raw.replace(/^http:/i,"https:");
  const parsed=new URL(fixed);
  if(parsed.protocol!=="https:"||parsed.port||!["linkedin.com","www.linkedin.com"].includes(parsed.hostname.toLowerCase())||parsed.username||parsed.password)return "";
  const path=parsed.pathname.replace(/\/$/,"");
  if(!/^\/in\/[a-z0-9][a-z0-9_.%-]{1,180}$/i.test(path))return "";
  return "https://www.linkedin.com"+path.toLowerCase();
 }catch{return ""}
};
function parseCSV(text,separator){
 const out=[];let row=[],field="",quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){
   if(quoted&&text[i+1]==='"'){field+='"';i++;}
   else if(quoted)quoted=false;
   else if(field==="")quoted=true;
   else field+=c;
  }else if(c===separator&&!quoted){row.push(field);field="";}
  else if((c==="\n"||c==="\r")&&!quoted){
   if(c==="\r"&&text[i+1]==="\n")i++;
   row.push(field);out.push(row);row=[];field="";
  }else field+=c;
 }
 if(quoted)throw Error("No se pudo leer el CSV: faltan comillas de cierre.");
 if(field!==""||row.length){row.push(field);out.push(row);}
 return out;
}
const alias={
 nombre:["firstname","nombre","nombres"],
 apellido:["lastname","apellido","apellidos"],
 empresa:["company","empresa","compania"],
 cargo:["position","puesto","cargo","posicion"],
 linkedin_url:["url","profileurl","linkedinurl","urldelperfil","perfil"],
 fecha_conexion:["connectedon","connectiondate","conectadoel","fechadeconexion"]
};
function parseConnections(text){
 if(typeof text!=="string"||!text.trim())throw Error("El CSV está vacío.");
 const raw=text.replace(/^\uFEFF/,""),separators=[",",";","\t"];
 let parsed=null,headerIndex=-1,fieldIndex=null;
 for(const sep of separators){
  const rows=parseCSV(raw,sep);
  for(let i=0;i<Math.min(40,rows.length);i++){
   const cells=rows[i].map(norm),index={};
   for(const [field,synonyms] of Object.entries(alias)){
    index[field]=cells.findIndex(c=>synonyms.includes(c));
   }
   if(index.nombre>=0&&index.apellido>=0&&(index.empresa>=0||index.linkedin_url>=0)){
    parsed=rows;headerIndex=i;fieldIndex=index;break;
   }
  }
  if(parsed)break;
 }
 if(!parsed)throw Error("No se encontraron las columnas Nombre/Apellido de Connections.csv. Descarga la exportación oficial de LinkedIn.");
 const data=[],seen=new Set(),errors=[];
 let discarded=0,duplicateFile=0;
 for(let i=headerIndex+1;i<parsed.length;i++){
  const row=parsed[i],get=k=>{
   const n=fieldIndex[k];
   return n>=0?String(row[n]||"").replace(/[\u0000-\u001f]/g," ").trim():"";
  };
  const nombre=get("nombre"),apellido=get("apellido"),empresa=get("empresa");
  const urlRaw=get("linkedin_url"),url=canonical(urlRaw),cargo=get("cargo"),fecha=get("fecha_conexion");
  if(!nombre&&!apellido&&!empresa&&!urlRaw)continue;
  if(!nombre||!apellido||(!empresa&&!url)){discarded++;if(errors.length<6)errors.push("Fila "+(i+1)+": faltan nombre, apellido o empresa/URL.");continue;}
  if(urlRaw&&!url){discarded++;if(errors.length<6)errors.push("Fila "+(i+1)+": URL LinkedIn inválida.");continue;}
  const key=url||norm(nombre)+"|"+norm(apellido)+"|"+norm(empresa);
  if(seen.has(key)){duplicateFile++;continue;}
  seen.add(key);
  data.push({nombre,apellido,empresa,cargo,linkedin_url:url,fecha_conexion:fecha,ubicacion:"",peru_verificado:false});
  if(data.length>20000)throw Error("El archivo contiene más de 20.000 contactos. Divide la carga en archivos más pequeños.");
 }
 if(!data.length)throw Error("No se encontraron contactos válidos en el CSV.");
 return {contacts:data,discarded,duplicateFile,errors,headerRow:headerIndex+1};
}
const initial=()=>({nombre:"",apellido:"",empresa:"",cargo:"",linkedin_url:"",ubicacion:"",peru_verificado:false});
let root=null,client=null,rows=[],loads=[],total=0,filteredTotal=0,page=0,pageSize=100,loaded=false,loading=false,busy=false;
let tab="list",parsed=null,fileName="",message="",error="",progress="",filter="",manual=initial(),epoch=0;
let operations=new Map(),members=[],myId=null,channel=null,refreshTimer=null,refreshPending=false,syncState="Conectando…";
const person=id=>members.find(x=>x.usuario_id===id)?.nombre||"Compañero";
function contactCell(x){
 return contactStatus(x)+(x.linkedin_url?'<button class="action" data-plan-url="'+esc(x.linkedin_url)+'" data-plan-name="'+esc(x.nombre+' '+x.apellido)+'">+ Seguimiento</button>':'');
}
function contactStatus(x){
 if(!x.linkedin_url)return '<span class="research-muted">Agrega la URL para coordinar el contacto</span>';
 const op=operations.get(x.linkedin_url),state=op?.estado;
 const data=' data-contact-url="'+esc(x.linkedin_url)+'" data-version="'+(op?.version||0)+'"';
 if(state==="contactado")return '<b>Contactado por '+esc(person(op.contactado_por))+'</b><br><small>'+esc(new Date(op.contactado_en).toLocaleString("es-PE"))+'</small>';
 if(state==="reservado")return '<b>En atención · '+esc(person(op.responsable))+'</b>'+(op.responsable===myId?'<div><button class="action" data-contact-action="confirmar"'+data+'>Ya envié el mensaje</button><button class="action" data-contact-action="cancelar"'+data+'>Cancelar · no envié</button></div>':'<br><small>Contacto bloqueado para evitar cruces</small>');
 return '<select aria-label="Responsable de '+esc(x.nombre)+'" data-contact-owner'+data+'><option value="">Sin asignar</option>'+members.map(m=>'<option value="'+esc(m.usuario_id)+'"'+(op?.responsable===m.usuario_id?' selected':'')+'>'+esc(m.nombre)+'</option>').join('')+'</select>'+(!op||op.responsable===myId?'<button class="action" data-contact-action="reservar"'+data+'>Reservar contacto</button>':'<small>Por contactar · '+esc(person(op.responsable))+'</small>');
}
async function contactAction(button,action,owner=null){
 if(busy||!client)return;
 if(action==="cancelar"&&!window.confirm("Libera el perfil solo si NO enviaste el mensaje. ¿Confirmas que no lo enviaste?"))return;
 const active=client,url=button.dataset.contactUrl,version=Number(button.dataset.version);
 busy=true;error="";message="";render();
 try{
  const res=await active.rpc("lr_acrm_contactar",{p_url:url,p_accion:action,p_responsable:owner,p_version:version});
  if(res.error)throw Error(res.error.message);
  if(client!==active)return;
  operations.set(url,res.data);
  message=action==="reservar"?"Reservado para ti. Abre el perfil, envía el mensaje y registra el contacto. La reserva no vence sola.":action==="confirmar"?"Contacto registrado para todo el equipo.":"Asignación actualizada.";
  if(action==="reservar")message+=' El enlace «Ver perfil» está en la misma fila.';
 }catch(e){error=String(e.message||e)+". Si se perdió la conexión, actualiza antes de volver a contactar.";}
 finally{busy=false;await load();render();}
}
function stopSync(){
 if(channel&&client)client.removeChannel(channel);
 channel=null;clearInterval(refreshTimer);refreshTimer=null;
}
function refresh(){if(!root?.isConnected)return;if(loading||busy){refreshPending=true;return;}load();}
function startSync(){
 if(!client||channel)return;
 const active=client;
 channel=client.channel("acrm-contactos-"+crypto.randomUUID())
 .on("postgres_changes",{event:"*",schema:"public",table:"lr_acrm_contactos"},refresh)
 .on("postgres_changes",{event:"*",schema:"public",table:"lr_pros_contactos_propios"},refresh)
 .subscribe(status=>{if(client!==active)return;syncState=status==="SUBSCRIBED"?"En vivo":"Reconectando · respaldo cada 15 s";if(status==="SUBSCRIBED")refresh();});
 refreshTimer=setInterval(()=>{if(!root?.isConnected){stopSync();return;}if(!document.hidden)refresh();},15000);
}
function render(){
 if(!root||!root.isConnected)return;
 const focused=document.activeElement;
 const filterFocus=focused?.id==="lrOwnFilter";
 const filterDraft=filterFocus?focused.value:null;
 const cursor=filterFocus?focused.selectionStart:null;
 const showing=rows;
 const pages=Math.max(1,Math.ceil(filteredTotal/pageSize));
 let body="";
 if(tab==="list"){
  body='<div class="lr-own-filters"><label>Buscar contactos<input id="lrOwnFilter" value="'+esc(filter)+'" placeholder="Nombre, empresa o cargo"></label></div>'+
  '<div class="research-table"><table><thead><tr><th>Contacto</th><th>Empresa</th><th>Cargo</th><th>LinkedIn</th><th>Ubicación</th><th>Aportado por</th><th>Próxima acción / contacto</th></tr></thead><tbody>'+
  (showing.length?showing.map(x=>'<tr><td><b>'+esc(x.nombre+" "+x.apellido)+'</b></td><td>'+esc(x.empresa||"—")+'</td><td>'+esc(x.cargo||"—")+'</td><td>'+(x.linkedin_url?(operations.get(x.linkedin_url)?.responsable===myId&&operations.get(x.linkedin_url)?.estado!=='asignado'?'<a target="_blank" rel="noopener noreferrer" href="'+esc(x.linkedin_url)+'">Ver perfil</a>':'<span class="research-muted">Reserva para abrir</span>'):'<span class="research-muted">Sin enlace</span>')+'</td><td>'+esc(x.ubicacion||"Por verificar")+'</td><td>'+esc(x.aportado_por||"—")+'</td><td>'+contactCell(x)+'</td></tr>').join(""):
  '<tr><td colspan="7">No hay contactos para este filtro.</td></tr>')+
  '</tbody></table></div>'+
  '<div class="lr-own-pagination"><button class="action" id="lrOwnPrev"'+(page<=0?' disabled':'')+'>Anterior</button>'+
  '<span class="research-muted">Página '+(page+1)+' de '+pages+' · '+filteredTotal+' coincidencias · '+total+' contactos únicos</span>'+
  '<button class="action" id="lrOwnNext"'+((page+1)>=pages?' disabled':'')+'>Siguiente</button></div>';
 }else if(tab==="upload"){
  body='<h3>Importar conexiones desde LinkedIn</h3><p class="research-muted">Selecciona <b>Connections.csv</b> de tu exportación oficial. Cada usuario agrega sus contactos a «Todos»; las próximas cargas actualizan datos y conservan el historial. No se borran contactos ausentes.</p>'+
  '<input type="file" id="lrOwnCsvFile" accept=".csv,text/csv,text/plain">'+
  (parsed?'<div class="lr-own-summary"><strong>'+parsed.contacts.length+'</strong> contactos preparados · '+parsed.discarded+' incompletos · '+parsed.duplicateFile+' repetidos dentro del archivo'+
   '<div class="research-muted">Cabecera detectada en fila '+parsed.headerRow+'. No se importan las direcciones de correo del archivo.</div></div>'+
   '<div class="research-table"><table><thead><tr><th>Nombre</th><th>Empresa</th><th>Cargo</th><th>URL LinkedIn</th></tr></thead><tbody>'+
   parsed.contacts.slice(0,5).map(x=>'<tr><td>'+esc(x.nombre+" "+x.apellido)+'</td><td>'+esc(x.empresa||"—")+'</td><td>'+esc(x.cargo||"—")+'</td><td>'+esc(x.linkedin_url?"Sí":"No incluida")+'</td></tr>').join("")+
   '</tbody></table></div>'+
   (parsed.errors.length?'<p class="research-muted">'+esc(parsed.errors.slice(0,3).join(" | "))+'</p>':"")+
   '<div class="research-actions"><button class="action primary" id="lrOwnImport"'+(busy?" disabled":"")+'>Actualizar mi base con este archivo</button><button class="action" id="lrOwnDiscard">Descartar</button></div>':
   '<p class="research-muted">Si aún tienes la solicitud pendiente en LinkedIn, carga el CSV cuando recibas el enlace de descarga. No necesitamos el ZIP completo.</p>');
 }else if(tab==="manual"){
  const fields=[["nombre","Nombre *"],["apellido","Apellido *"],["empresa","Empresa"],["cargo","Cargo"],["linkedin_url","URL del perfil LinkedIn *"],["ubicacion","Ubicación visible"]];
  body='<h3>Agregar o actualizar un perfil</h3><p class="research-muted">Agrega un perfil a «Todos». Si otra persona aportó la misma URL de LinkedIn, la lista consolidada mostrará una sola ficha con ambos aportantes.</p>'+
  '<div class="lr-own-form">'+fields.map(([k,label])=>'<label>'+label+'<input data-lr-own-field="'+k+'" value="'+esc(manual[k]||"")+'" maxlength="'+(k==="linkedin_url"?350:200)+'" placeholder="'+(k==="linkedin_url"?"https://www.linkedin.com/in/usuario":"")+'"></label>').join("")+'</div>'+
  '<label class="lr-own-checkbox" style="margin-top:12px"><input type="checkbox" id="lrOwnManualPeru"'+(manual.peru_verificado?" checked":"")+'> Verifiqué que la ubicación visible del perfil es Perú</label>'+
  '<div class="research-actions"><button class="action primary" id="lrOwnAdd"'+(busy?" disabled":"")+'>Guardar en mi base</button></div>';
 }else{
  body='<h3>Historial de cargas de mi cuenta</h3><p class="research-muted">Se guardan resúmenes por lote, no copias completas del CSV.</p>'+
  '<div class="research-table"><table><thead><tr><th>Fecha</th><th>Archivo</th><th>Procesados</th><th>Nuevos</th><th>Actualizados</th><th>Sin cambios</th><th>Rechazados</th></tr></thead><tbody>'+
  (loads.length?loads.map(x=>'<tr><td>'+esc(new Date(x.creado_en).toLocaleString("es-PE"))+'</td><td>'+esc(x.archivo)+'</td><td>'+x.procesados+'</td><td>'+x.nuevos+'</td><td>'+x.actualizados+'</td><td>'+x.sin_cambios+'</td><td>'+x.rechazados+'</td></tr>').join(""):'<tr><td colspan="7">Todavía no hay cargas.</td></tr>')+'</tbody></table></div>';
 }
 root.innerHTML='<p class="research-muted">'+esc(syncState)+' · LinkedIn · Reserva antes de enviar un mensaje.</p><nav class="lr-own-nav">'+[["list","Todos"],["upload","Cargar CSV"],["manual","Agregar perfil"],["history","Historial de cargas"]].map(([id,label])=>
 '<button data-lr-own-tab="'+id+'" class="'+(id===tab?"sel":"")+'">'+label+'</button>').join("")+'</nav>'+
 (error?'<div class="research-msg err">'+esc(error)+'</div>':"")+(message?'<div class="research-msg">'+esc(message)+'</div>':"")+
 (busy?'<div class="lr-own-progress">'+esc(progress||"Procesando…")+'</div>':"")+
 '<div class="lr-own-content">'+body+'</div>';
 root.querySelectorAll("[data-lr-own-tab]").forEach(b=>b.addEventListener("click",()=>{tab=b.dataset.lrOwnTab;error="";message="";render();}));
 root.querySelector("#lrOwnFilter")?.addEventListener("change",e=>{filter=e.target.value;page=0;load();});
 root.querySelector("#lrOwnPrev")?.addEventListener("click",()=>{if(page>0){page--;load();}});
 root.querySelector("#lrOwnNext")?.addEventListener("click",()=>{if((page+1)*pageSize<filteredTotal){page++;load();}});
 root.querySelector("#lrOwnCsvFile")?.addEventListener("change",readCsvFile);
 root.querySelector("#lrOwnImport")?.addEventListener("click",uploadCsv);
 root.querySelector("#lrOwnDiscard")?.addEventListener("click",()=>{parsed=null;fileName="";message="";render();});
 root.querySelectorAll("[data-lr-own-field]").forEach(el=>el.addEventListener("input",()=>{manual[el.dataset.lrOwnField]=el.value;}));
 root.querySelector("#lrOwnManualPeru")?.addEventListener("change",e=>{manual.peru_verificado=e.target.checked;});
 root.querySelector("#lrOwnAdd")?.addEventListener("click",addManual);
 root.querySelectorAll("[data-contact-action]").forEach(b=>{b.disabled=busy;b.addEventListener("click",()=>contactAction(b,b.dataset.contactAction));});
 root.querySelectorAll("[data-contact-owner]").forEach(b=>{b.disabled=busy;b.addEventListener("change",()=>{if(b.value)contactAction(b,"asignar",b.value);});});
 root.querySelectorAll('[data-plan-url]').forEach(b=>b.onclick=()=>window.LRACRM?.openNew('li:'+b.dataset.planUrl,b.dataset.planName,operations.get(b.dataset.planUrl)?.responsable||myId));
 if(filterFocus){const el=root.querySelector("#lrOwnFilter");if(el){el.value=filterDraft;el.focus();el.setSelectionRange(cursor,cursor);}}
}
async function readCsvFile(event){
 const file=event.target.files?.[0];if(!file)return;
 try{
  if(file.size>10*1024*1024)throw Error("Archivo demasiado grande (máximo 10 MB).");
  const content=await file.text();
  parsed=parseConnections(content);
  fileName=String(file.name||"Connections.csv").slice(0,180);
  error="";message="Archivo leído localmente. Revisa el resumen antes de actualizar la base.";
 }catch(e){parsed=null;error=String(e.message||e);message="";}
 render();
}
async function load(){
 if(!client||loading||busy)return;
 const activeClient=client,run=++epoch;
 loading=true;
 try{
  let query=activeClient.from("lr_pros_contactos_unificados")
    .select("id,nombre,apellido,empresa,cargo,linkedin_url,ubicacion,peru_verificado,actualizado_en,aportado_por,cantidad_fuentes",{count:"exact"})
    .order("actualizado_en",{ascending:false}).order("id",{ascending:true});
  const sanitized=filter.trim().replace(/[(),%*]/g," ").slice(0,100).trim();
  if(sanitized)query=query.or(["nombre","apellido","empresa","cargo","ubicacion","linkedin_url"].map(k=>k+".ilike.%"+sanitized+"%").join(","));
  const [contacts,history,fullCount,team,user]=await Promise.all([
   query.range(page*pageSize,page*pageSize+pageSize-1),
   activeClient.from("lr_pros_cargas_propias")
    .select("archivo,creado_en,procesados,nuevos,actualizados,sin_cambios,rechazados")
    .order("creado_en",{ascending:false}).limit(40),
   activeClient.from("lr_pros_contactos_unificados").select("id",{count:"exact",head:true}),
   activeClient.from("lr_pros_colaboradores").select("usuario_id,nombre").eq("activo",true),
   activeClient.auth.getUser()
  ]);
  if(contacts.error)throw Error("Contactos: "+contacts.error.message);
  if(history.error)throw Error("Historial: "+history.error.message);
  if(fullCount.error)throw Error("Conteo total: "+fullCount.error.message);
  if(team.error)throw Error(team.error.message);
  if(user.error)throw Error(user.error.message);
  const urls=(contacts.data||[]).map(x=>x.linkedin_url).filter(Boolean);
  const ops=urls.length?await activeClient.from("lr_acrm_contactos").select("*").in("linkedin_url",urls):{data:[]};
  if(ops.error)throw Error("Coordinación de contactos: "+ops.error.message);
  if(client!==activeClient||run!==epoch)return;
  members=team.data||[];myId=user.data?.user?.id;operations=new Map((ops.data||[]).map(x=>[x.linkedin_url,x]));
  rows=contacts.data||[];total=fullCount.count??rows.length;
  filteredTotal=contacts.count??rows.length;loads=history.data||[];loaded=true;
 }catch(e){error=String(e.message||e);}
 finally{if(client===activeClient&&run===epoch){loading=false;if(tab==="list")render();if(refreshPending){refreshPending=false;refresh();}}}
}
async function uploadCsv(){
 if(busy||!client||!parsed?.contacts.length)return;
 busy=true;error="";message="";progress="Preparando carga…";render();
 const records=parsed.contacts,lote=crypto.randomUUID(),chunkSize=100;
 const totals={nuevos:0,actualizados:0,sin_cambios:0,rechazados:0,procesados:0};
 let errors=[];
 try{
  for(let i=0;i<records.length;i+=chunkSize){
   progress="Cargando "+Math.min(i+chunkSize,records.length)+" de "+records.length+" contactos";
   render();
   const payload={lote_id:lote,parte:Math.floor(i/chunkSize),origen:"connections_csv",archivo:fileName||"Connections.csv",contactos:records.slice(i,i+chunkSize)};
   const res=await client.rpc("lr_pros_importar_mis_contactos",{p_datos:payload});
   if(res.error)throw Error("No se pudo completar la parte "+(Math.floor(i/chunkSize)+1)+": "+res.error.message);
   for(const k of Object.keys(totals))totals[k]+=Number(res.data?.[k]||0);
   if(Array.isArray(res.data?.errores))errors.push(...res.data.errores.slice(0,3));
  }
  message="Contactos aportados al equipo: "+totals.nuevos+" nuevos, "+totals.actualizados+" actualizados, "+
   totals.sin_cambios+" sin cambios, "+totals.rechazados+" rechazados.";
  if(errors.length)error="Revisa estas filas: "+errors.slice(0,3).map(x=>x.fila+" ("+x.motivo+")").join(" | ");
  parsed=null;fileName="";tab="list";
 }catch(e){error=String(e.message||e)+". Las partes completadas se conservan; puedes volver a subir el mismo CSV sin duplicados.";}
 finally{busy=false;progress="";await load();render();}
}
async function addManual(){
 if(busy||!client)return;
 const record={...manual,linkedin_url:canonical(manual.linkedin_url)};
 if(!record.nombre.trim()||!record.apellido.trim()||!record.linkedin_url){error="Completa nombre, apellido y una URL válida de LinkedIn /in/.";render();return;}
 if(record.peru_verificado&&!/(^|[^a-z])peru([^a-z]|$)/.test(String(record.ubicacion||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase())){error="Para confirmar Perú, incluye ese país en la ubicación visible.";render();return;}
 busy=true;error="";message="";render();
 try{
  const payload={lote_id:crypto.randomUUID(),parte:0,archivo:"perfil_manual",origen:"manual",contactos:[record]};
  const res=await client.rpc("lr_pros_importar_mis_contactos",{p_datos:payload});
  if(res.error)throw Error(res.error.message);
  if(res.data?.rechazados)throw Error(res.data?.errores?.[0]?.motivo||"El perfil no se pudo registrar.");
  const kind=res.data?.nuevos?"agregado":res.data?.actualizados?"actualizado":"ya estaba actualizado";
  message="Perfil "+kind+"; ya está disponible en «Todos».";
  manual=initial();tab="list";
 }catch(e){error=String(e.message||e);}
 finally{busy=false;await load();render();}
}
function reset(){rows=[];loads=[];total=0;filteredTotal=0;page=0;loaded=false;busy=false;loading=false;parsed=null;fileName="";message="";error="";progress="";filter="";manual=initial();tab="list";epoch++;}
function mount(element,supabase){
 if(!element)return;
 if(client!==supabase){stopSync();reset();operations=new Map();members=[];myId=null;client=supabase;}
 root=element;render();startSync();
 if(client&&!loaded&&!loading&&!busy)load();
}
function unmount(){stopSync();root=null;}
function focusContact(url){filter=url;page=0;tab='list';load();root?.scrollIntoView({block:'start',behavior:'smooth'});}
// Lo mismo que focusContact, pero esperando la lectura y devolviendo la ficha. Lo usa el agente
// IA del ACRM: antes de escribirle en frío a alguien necesita su empresa y su cargo, no solo el
// nombre. Va por el mismo filtro que la lista, así no hay una segunda lectura con otras reglas.
async function focusContactInfo(url){
 const buscado=canonical(url)||String(url||"").trim();
 if(!buscado)return null;
 filter=buscado;page=0;tab='list';
 await load();
 root?.scrollIntoView({block:'start',behavior:'smooth'});
 const fila=rows.find(x=>x.linkedin_url===buscado);
 if(!fila)return null;
 return {nombre:fila.nombre,apellido:fila.apellido,empresa:fila.empresa,cargo:fila.cargo,ubicacion:fila.ubicacion,linkedin_url:fila.linkedin_url,aportado_por:fila.aportado_por};
}
window.LRProsContactosPropios={mount,unmount,parseConnections,canonical,focusContact,focusContactInfo};
})();
