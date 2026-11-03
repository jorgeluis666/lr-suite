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
const segmentos={sin_clasificar:"Sin clasificar",ecommerce:"E-Commerce",servicios:"Servicios",ambos:"E-Commerce y Servicios",otro:"Otro"};
const estados={por_contactar:"Por contactar",contactado:"Contactado",respondio:"Respondió",reunion:"Reunión",cliente:"Cliente",descartado:"Descartado"};
const hoy=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const options=(values,current)=>Object.entries(values).map(([k,v])=>'<option value="'+esc(k)+'"'+(k===current?' selected':'')+'>'+esc(v)+'</option>').join('');
let segmento="",estado="",pendientes=false,selected=null,events=[],detailBusy=false,detailError="",messageId=null;
function render(){
 if(!root||!root.isConnected)return;
 const showing=rows;
 const pages=Math.max(1,Math.ceil(filteredTotal/pageSize));
 let body="";
 if(tab==="list"){
  body='<div class="lr-own-filters"><label>Buscar contactos<input id="lrOwnFilter" value="'+esc(filter)+'" placeholder="Nombre, empresa o cargo"></label>'+
  '<label>Tipo de empresa<select id="lrSegmento">'+options({'':'Todas',...segmentos},segmento)+'</select></label>'+
  '<label>Estado<select id="lrEstado">'+options({'':'Todos',...estados},estado)+'</select></label>'+
  '<label class="lr-own-checkbox"><input id="lrPendientes" type="checkbox"'+(pendientes?' checked':'')+'>Seguimientos vencidos / hoy</label></div>'+
  '<div class="research-table"><table><thead><tr><th>Contacto</th><th>Empresa / tipo</th><th>Trabajadores</th><th>Mensajes enviados</th><th>Estado / próximo contacto</th><th>Seguimiento</th></tr></thead><tbody>'+
  (showing.length?showing.map(x=>'<tr><td><b>'+esc(x.nombre+" "+x.apellido)+'</b><div class="research-muted">'+esc(x.cargo||'')+'</div>'+(x.linkedin_url?'<a target="_blank" rel="noopener noreferrer" href="'+esc(x.linkedin_url)+'">LinkedIn</a>':'')+'</td><td>'+esc(x.empresa||'—')+'<div class="research-muted">'+esc(segmentos[x.segmento])+'</div></td><td>'+esc(x.trabajadores??'Por verificar')+'</td><td>'+esc(x.mensajes_enviados||0)+'<div class="research-muted">Último: '+esc(x.ultimo_mensaje||'—')+'</div></td><td>'+esc(estados[x.estado])+'<div class="'+(x.proximo_contacto&&x.proximo_contacto<=hoy()?'lr-overdue':'research-muted')+'">'+esc(x.proximo_contacto||'Sin fecha')+'</div></td><td><button class="action" data-follow="'+esc(x.id)+'">Gestionar</button><div class="research-muted">'+esc(x.aportado_por||'')+'</div></td></tr>').join(""):
  '<tr><td colspan="6">'+(loading?'Cargando…':'No hay contactos para este filtro.')+'</td></tr>')+
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
 root.innerHTML='<nav class="lr-own-nav">'+[["list","Todos"],["upload","Cargar CSV"],["manual","Agregar perfil"],["history","Historial de cargas"]].map(([id,label])=>
 '<button data-lr-own-tab="'+id+'" class="'+(id===tab?"sel":"")+'">'+label+'</button>').join("")+'</nav>'+
 (error?'<div class="research-msg err">'+esc(error)+'</div>':"")+(message?'<div class="research-msg">'+esc(message)+'</div>':"")+
 (busy?'<div class="lr-own-progress">'+esc(progress||"Procesando…")+'</div>':"")+
 '<div class="lr-own-content">'+body+'</div><div id="lrDetail"></div>';
 renderDetail();
 root.querySelectorAll('[data-follow]').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.follow)));
 root.querySelector('#lrSegmento')?.addEventListener('change',e=>{segmento=e.target.value;page=0;load();});
 root.querySelector('#lrEstado')?.addEventListener('change',e=>{estado=e.target.value;page=0;load();});
 root.querySelector('#lrPendientes')?.addEventListener('change',e=>{pendientes=e.target.checked;page=0;load();});
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
 if(!client||busy)return;
 const activeClient=client,run=++epoch;
 loading=true;render();
 try{
  let query=activeClient.from("lr_pros_seguimiento")
    .select("id,nombre,apellido,empresa,cargo,linkedin_url,ubicacion,peru_verificado,actualizado_en,aportado_por,cantidad_fuentes,identidad,segmento,trabajadores,fuente,verificado_en,estado,proximo_contacto,mensajes_enviados,ultimo_mensaje",{count:"exact"})
    .order("actualizado_en",{ascending:false}).order("id",{ascending:true});
  if(segmento==='ecommerce'||segmento==='servicios')query=query.in('segmento',[segmento,'ambos']);
  else if(segmento)query=query.eq('segmento',segmento);
  if(estado)query=query.eq('estado',estado);
  if(pendientes)query=query.lte('proximo_contacto',hoy()).not('estado','in','(cliente,descartado)');
  const sanitized=filter.trim().replace(/[(),%*]/g," ").slice(0,100).trim();
  if(sanitized)query=query.or(["nombre","apellido","empresa","cargo","ubicacion"].map(k=>k+".ilike.%"+sanitized+"%").join(","));
  const [contacts,history,fullCount]=await Promise.all([
   query.range(page*pageSize,page*pageSize+pageSize-1),
   activeClient.from("lr_pros_cargas_propias")
    .select("archivo,creado_en,procesados,nuevos,actualizados,sin_cambios,rechazados")
    .order("creado_en",{ascending:false}).limit(40),
   activeClient.from("lr_pros_seguimiento").select("id",{count:"exact",head:true})
  ]);
  if(contacts.error)throw Error("Contactos: "+contacts.error.message);
  if(history.error)throw Error("Historial: "+history.error.message);
  if(fullCount.error)throw Error("Conteo total: "+fullCount.error.message);
  if(client!==activeClient||run!==epoch)return;
  rows=contacts.data||[];total=fullCount.count??rows.length;
  filteredTotal=contacts.count??rows.length;loads=history.data||[];loaded=true;
 }catch(e){if(run===epoch)error=String(e.message||e);}
 finally{if(run===epoch){loading=false;render();}}
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
async function openDetail(id){
 selected=rows.find(x=>x.id===id);events=[];detailError='';messageId=crypto.randomUUID();
 if(!selected)return;
 const identity=selected.identidad;detailBusy=true;renderDetail();
 try{
  const result=await client.from('lr_pros_mensajes').select('id,enviado_en,canal,tema,creado_por').eq('identidad',identity).order('enviado_en',{ascending:false}).limit(200);
  if(selected?.identidad!==identity)return;
  if(result.error)throw Error(result.error.message);
  events=result.data||[];
 }catch(e){if(selected?.identidad===identity)detailError=String(e.message||e);}
 finally{if(selected?.identidad===identity){detailBusy=false;renderDetail();}}
 root.querySelector('#lrDetail')?.scrollIntoView?.({behavior:'smooth',block:'start'});
}
function renderDetail(){
 const panel=root?.querySelector('#lrDetail');if(!panel)return;
 if(!selected){panel.innerHTML='';return;}
 const x=selected;
 panel.innerHTML='<section class="lr-follow-panel" aria-label="Seguimiento del contacto"><div class="research-head"><div><h3>'+esc(x.nombre+' '+x.apellido)+'</h3><p>'+esc(x.empresa||'Sin empresa')+'</p></div><button class="action" id="lrCloseDetail"'+(detailBusy?' disabled':'')+'>Cerrar</button></div>'+
 '<p class="research-muted">Datos compartidos de esta ficha. Registra aquí los mensajes que ya enviaste.</p><p id="lrDetailStatus" role="status">'+esc(detailError||(detailBusy?'Cargando / guardando…':''))+'</p>'+
 '<form id="lrFicha"><div class="lr-own-form">'+
 '<label>Tipo de empresa<select name="segmento">'+options(segmentos,x.segmento)+'</select></label>'+
 '<label>Cantidad de trabajadores (si está verificada)<input name="trabajadores" type="number" min="0" max="100000000" step="1" value="'+esc(x.trabajadores??'')+'"></label>'+
 '<label>Fuente del dato (URL o referencia)<input name="fuente" maxlength="1000" value="'+esc(x.fuente||'')+'"></label>'+
 '<label>Fecha de verificación<input name="verificado_en" type="date" max="'+hoy()+'" value="'+esc(x.verificado_en||'')+'"></label>'+
 '<label>Estado comercial<select name="estado">'+options(estados,x.estado)+'</select></label>'+
 '<label>Próximo contacto<input name="proximo_contacto" type="date" value="'+esc(x.proximo_contacto||'')+'"></label></div>'+
 '<button class="action primary"'+(detailBusy?' disabled':'')+'>Guardar ficha</button></form>'+
 '<h3 class="lr-follow-title">Registrar mensaje enviado</h3><form id="lrMensaje"><div class="lr-own-form">'+
 '<label>Fecha de envío<input name="enviado_en" type="date" required max="'+hoy()+'" value="'+hoy()+'"></label>'+
 '<label>Canal<select name="canal">'+options({linkedin:'LinkedIn',correo:'Correo',whatsapp:'WhatsApp',otro:'Otro'},'linkedin')+'</select></label></div>'+
 '<label>Tema o resumen del mensaje<textarea name="tema" required maxlength="2000" placeholder="Ej.: Presentación de servicios y propuesta de reunión"></textarea></label>'+
 '<button class="action primary"'+(detailBusy?' disabled':'')+'>Registrar envío</button></form>'+
 '<h3 class="lr-follow-title">Historial de mensajes</h3><p class="research-muted">Hasta los 200 envíos más recientes; el contador incluye todo el historial.</p>'+
 (events.length?'<ol class="lr-message-history">'+events.map(m=>'<li><strong>'+esc(m.enviado_en)+' · '+esc(m.canal)+'</strong><p>'+esc(m.tema)+'</p></li>').join('')+'</ol>':'<p>Sin mensajes registrados.</p>')+'</section>';
 panel.querySelector('#lrCloseDetail').addEventListener('click',()=>{selected=null;renderDetail();});
 panel.querySelector('#lrFicha').addEventListener('submit',e=>saveDetail(e,'ficha'));
 panel.querySelector('#lrMensaje').addEventListener('submit',e=>saveDetail(e,'mensaje'));
}
async function saveDetail(event,kind){
 event.preventDefault();if(detailBusy||!selected)return;
 const form=event.currentTarget,data=Object.fromEntries(new FormData(form));
 const args={p_identidad:selected.identidad};
 if(kind==='ficha'){
  data.trabajadores=data.trabajadores===''?null:Number(data.trabajadores);
  data.verificado_en=data.verificado_en||null;data.proximo_contacto=data.proximo_contacto||null;
  if(data.trabajadores!==null&&(!data.fuente.trim()||!data.verificado_en)){
   root.querySelector('#lrDetailStatus').textContent='Indica la fuente y fecha de verificación de la cantidad de trabajadores.';return;
  }
  args.p_ficha=data;
 }else{data.id=messageId;args.p_mensaje=data;}
 detailBusy=true;
 form.querySelector('button').disabled=true;
 const identity=selected.identidad;
 try{
  const result=await client.rpc('lr_pros_guardar_seguimiento',args);
  if(result.error)throw Error(result.error.message);
  if(selected?.identidad!==identity)return;
  if(kind==='ficha')Object.assign(selected,data);
  else{messageId=crypto.randomUUID();if(selected.estado==='por_contactar')selected.estado='contactado';
   const history=await client.from('lr_pros_mensajes').select('id,enviado_en,canal,tema,creado_por').eq('identidad',identity).order('enviado_en',{ascending:false}).limit(200);
   if(history.error)throw Error('Mensaje guardado. No se pudo actualizar el historial: '+history.error.message);
   events=history.data||[];
  }
  detailError='Guardado.';detailBusy=false;await load();
 }catch(e){
  // Conserva los campos y el identificador para que reintentar no duplique un envío.
  detailError=String(e.message||e);root.querySelector('#lrDetailStatus').textContent=detailError;
 }finally{detailBusy=false;if(form.isConnected)form.querySelector('button').disabled=false;}
}

function reset(){selected=null;events=[];segmento="";estado="";pendientes=false;rows=[];loads=[];total=0;filteredTotal=0;page=0;loaded=false;busy=false;loading=false;parsed=null;fileName="";message="";error="";progress="";filter="";manual=initial();tab="list";epoch++;}
function mount(element,supabase){
 if(!element)return;
 if(client!==supabase){reset();client=supabase;}
 root=element;render();
 if(client&&!loaded&&!loading&&!busy)load();
}
function unmount(){root=null;}
window.LRProsContactosPropios={mount,unmount,parseConnections};
})();