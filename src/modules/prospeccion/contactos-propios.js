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
  if(!["linkedin.com","www.linkedin.com"].includes(parsed.hostname.toLowerCase())||parsed.username||parsed.password)return "";
  const path=parsed.pathname.replace(/\/$/,"");
  if(!/^\/in\/[a-z0-9][a-z0-9_.%-]{1,180}$/i.test(path))return "";
  return "https://www.linkedin.com"+path.toLowerCase();
 }catch{return ""}
};
function parseDelimited(input,separator){
 const out=[];let row=[],field="",quoted=false;
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(c==='"'){
   if(quoted&&input[i+1]==='"'){field+='"';i++;}
   else if(quoted){quoted=false;}
   else if(!field){quoted=true;}
   else{field+=c;}
  }else if(c===separator&&!quoted){row.push(field);row=[];field="";} // corrected below
  else if((c==="\n"||c==="\r")&&!quoted){
   if(c==="\r"&&input[i+1]==="\n")i++;
   row.push(field);out.push(row);row=[];field="";
  }else{field+=c;}
 }
 if(quoted)throw Error("CSV incompleto: hay comillas sin cerrar.");
 if(field!==""||row.length){row.push(field);out.push(row);}
 return out;
}
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
let root=null,client=null,rows=[],loads=[],total=0,loaded=false,loading=false,busy=false;
let tab="list",parsed=null,fileName="",message="",error="",progress="",filter="",peruOnly=false,manual=initial(),epoch=0;
function render(){
 if(!root||!root.isConnected)return;
 const showing=rows.filter(x=>(!peruOnly||x.peru_verificado)&&(!filter||[x.nombre,x.apellido,x.empresa,x.cargo,x.ubicacion].join(" ").toLowerCase().includes(filter.toLowerCase())));
 let body="";
 if(tab==="list"){
  body='<div class="lr-own-filters"><label>Filtrar contactos<input id="lrOwnFilter" value="'+esc(filter)+'" placeholder="Nombre, empresa o cargo"></label><label class="lr-own-checkbox"><input type="checkbox" id="lrOwnPeruOnly"'+(peruOnly?" checked":"")+'> Solo Perú confirmado</label></div>'+
  '<p class="research-muted">Cada usuario ve únicamente sus contactos. La exportación de LinkedIn puede no incluir ubicación: esos contactos quedan pendientes de verificación.</p>'+
  '<div class="research-table"><table><thead><tr><th>Contacto</th><th>Empresa</th><th>Cargo</th><th>LinkedIn</th><th>Ubicación</th></tr></thead><tbody>'+
  (showing.length?showing.slice(0,200).map(x=>'<tr><td><b>'+esc(x.nombre+" "+x.apellido)+'</b></td><td>'+esc(x.empresa||"—")+'</td><td>'+esc(x.cargo||"—")+'</td><td>'+(x.linkedin_url?'<a target="_blank" rel="noopener noreferrer" href="'+esc(x.linkedin_url)+'">Ver perfil</a>':'<span class="research-muted">URL no incluida</span>')+'</td><td>'+(x.peru_verificado?'<span class="research-badge">Perú confirmado</span>':esc(x.ubicacion||"Por verificar"))+'</td></tr>').join(""):
  '<tr><td colspan="5">No hay contactos para este filtro.</td></tr>')+
  '</tbody></table></div><p class="research-muted">Mostrando hasta 200 contactos recientes; total en tu base: '+total+'. Para actualizar datos o completar perfiles, utiliza una nueva carga o «Agregar perfil».</p>';
 }else if(tab==="upload"){
  body='<h3>Importar conexiones desde LinkedIn</h3><p class="research-muted">Selecciona <b>Connections.csv</b> de tu exportación oficial. Si vuelves a cargarlo, se agregan los nuevos y se actualizan los existentes. Nunca se borran contactos por faltar en una nueva exportación.</p>'+
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
  body='<h3>Agregar o actualizar un perfil</h3><p class="research-muted">Usa este formulario para añadir nuevos contactos o completar datos de uno existente. Una URL de LinkedIn repetida actualiza la ficha de tu cuenta.</p>'+
  '<div class="lr-own-form">'+fields.map(([k,label])=>'<label>'+label+'<input data-lr-own-field="'+k+'" value="'+esc(manual[k]||"")+'" maxlength="'+(k==="linkedin_url"?350:200)+'" placeholder="'+(k==="linkedin_url"?"https://www.linkedin.com/in/usuario":"")+'"></label>').join("")+'</div>'+
  '<label class="lr-own-checkbox" style="margin-top:12px"><input type="checkbox" id="lrOwnManualPeru"'+(manual.peru_verificado?" checked":"")+'> Verifiqué que la ubicación visible del perfil es Perú</label>'+
  '<div class="research-actions"><button class="action primary" id="lrOwnAdd"'+(busy?" disabled":"")+'>Guardar en mi base</button></div>';
 }else{
  body='<h3>Historial de cargas de mi cuenta</h3><p class="research-muted">Se guardan resúmenes por lote, no copias completas del CSV.</p>'+
  '<div class="research-table"><table><thead><tr><th>Fecha</th><th>Archivo</th><th>Procesados</th><th>Nuevos</th><th>Actualizados</th><th>Sin cambios</th><th>Rechazados</th></tr></thead><tbody>'+
  (loads.length?loads.map(x=>'<tr><td>'+esc(new Date(x.creado_en).toLocaleString("es-PE"))+'</td><td>'+esc(x.archivo)+'</td><td>'+x.procesados+'</td><td>'+x.nuevos+'</td><td>'+x.actualizados+'</td><td>'+x.sin_cambios+'</td><td>'+x.rechazados+'</td></tr>').join(""):'<tr><td colspan="7">Todavía no hay cargas.</td></tr>')+'</tbody></table></div>';
 }
 root.innerHTML='<div class="lr-own-head"><div><h3>Mi base de contactos LinkedIn</h3><p class="research-muted">Tus cargas son privadas de tu usuario y se actualizan de forma incremental.</p></div><button class="action" id="lrOwnRefresh"'+(busy?" disabled":"")+'>Actualizar</button></div>'+
 '<div class="research-metrics lr-own-metrics"><div><strong>'+total+'</strong><span class="research-muted">Contactos en mi cuenta</span></div>'+
 '<div><strong>'+rows.filter(x=>x.peru_verificado).length+'</strong><span class="research-muted">Perú confirmado entre los visibles</span></div></div>'+
 '<nav class="lr-own-nav">'+[["list","Mis contactos"],["upload","Cargar CSV"],["manual","Agregar perfil"],["history","Historial de cargas"]].map(([id,label])=>
 '<button data-lr-own-tab="'+id+'" class="'+(id===tab?"sel":"")+'">'+label+'</button>').join("")+'</nav>'+
 (error?'<div class="research-msg err">'+esc(error)+'</div>':"")+(message?'<div class="research-msg">'+esc(message)+'</div>':"")+
 (busy?'<div class="lr-own-progress">'+esc(progress||"Procesando…")+'</div>':"")+
 '<div class="lr-own-content">'+body+'</div>';
 root.querySelectorAll("[data-lr-own-tab]").forEach(b=>b.addEventListener("click",()=>{tab=b.dataset.lrOwnTab;error="";message="";render();}));
 root.querySelector("#lrOwnRefresh")?.addEventListener("click",load);
 root.querySelector("#lrOwnFilter")?.addEventListener("change",e=>{filter=e.target.value;render();});
 root.querySelector("#lrOwnPeruOnly")?.addEventListener("change",e=>{peruOnly=e.target.checked;render();});
 root.querySelector("#lrOwnCsvFile")?.addEventListener("change",readCsvFile);
 root.querySelector("#lrOwnImport")?.addEventListener("click",uploadCsv);
 root.querySelector("#lrOwnDiscard")?.addEventListener("click",()=>{parsed=null;fileName="";message="";render();});
 root.querySelectorAll("[data-lr-own-field]").forEach(el=>el.addEventListener("input",()=>{manual[el.dataset.lrOwnField]=el.value;}));
 root.querySelector("#lrOwnManualPeru")?.addEventListener("change",e=>{manual.peru_verificado=e.target.checked;});
 root.querySelector("#lrOwnAdd")?.addEventListener("click",addManual);
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
 loading=true;error="";render();
 try{
  const [contacts,history]=await Promise.all([
   activeClient.from("lr_pros_contactos_propios")
    .select("id,nombre,apellido,empresa,cargo,linkedin_url,ubicacion,peru_verificado,actualizado_en",{count:"exact"})
    .order("actualizado_en",{ascending:false}).limit(200),
   activeClient.from("lr_pros_cargas_propias")
    .select("archivo,creado_en,procesados,nuevos,actualizados,sin_cambios,rechazados")
    .order("creado_en",{ascending:false}).limit(40)
  ]);
  if(contacts.error)throw Error("Contactos: "+contacts.error.message);
  if(history.error)throw Error("Historial: "+history.error.message);
  if(client!==activeClient||run!==epoch)return;
  rows=contacts.data||[];total=contacts.count??rows.length;loads=history.data||[];loaded=true;
 }catch(e){error=String(e.message||e);}
 finally{loading=false;render();}
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
  message="Base actualizada: "+totals.nuevos+" nuevos, "+totals.actualizados+" actualizados, "+
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
 if(record.peru_verificado&&!/\bper[uú]\b/i.test(record.ubicacion)){error="Para confirmar Perú, incluye ese país en la ubicación visible.";render();return;}
 busy=true;error="";message="";render();
 try{
  const payload={lote_id:crypto.randomUUID(),parte:0,archivo:"perfil_manual",origen:"manual",contactos:[record]};
  const res=await client.rpc("lr_pros_importar_mis_contactos",{p_datos:payload});
  if(res.error)throw Error(res.error.message);
  if(res.data?.rechazados)throw Error(res.data?.errores?.[0]?.motivo||"El perfil no se pudo registrar.");
  const kind=res.data?.nuevos?"agregado":res.data?.actualizados?"actualizado":"ya estaba actualizado";
  message="Perfil "+kind+" en tu base personal.";
  manual=initial();tab="list";
 }catch(e){error=String(e.message||e);}
 finally{busy=false;await load();render();}
}
function reset(){rows=[];loads=[];total=0;loaded=false;busy=false;loading=false;parsed=null;fileName="";message="";error="";progress="";filter="";peruOnly=false;manual=initial();tab="list";epoch++;}
function mount(element,supabase){
 if(!element)return;
 if(client!==supabase){reset();client=supabase;}
 root=element;render();
 if(client&&!loaded&&!loading&&!busy)load();
}
function unmount(){root=null;}
window.LRProsContactosPropios={mount,unmount,parseConnections};
})();