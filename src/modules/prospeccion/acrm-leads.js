// La tabla maestra del ACRM: todos los leads —LinkedIn, Meta Ads / WhatsApp y directos— en una sola
// lista, con su etapa, su próxima acción y su cotización si la tiene. Este archivo solo trae y
// escribe datos; la pantalla vive en el index.html (acrmLeadsModule), al lado de Cotizaciones, cuyas
// celdas reutiliza.
//
// La lista se lee desde el embudo y no desde las capturas: cada captura tiene su fila de embudo
// (la crea un trigger), y el embudo sabe cuándo se movió cada lead por última vez. Ordenar por eso
// deja arriba lo que está vivo y abajo los miles de perfiles de LinkedIn sin tocar. Se pagina en el
// servidor: son más de cuatro mil filas.
(function(){
"use strict";
const ETAPAS=['nuevo','contactado','respondio','cotizado','ganado','perdido'];
const ETAPA_TEXTO={nuevo:'Sin tocar',contactado:'Contactado',respondio:'Respondió',cotizado:'Cotizado',ganado:'Ganado',perdido:'Perdido'};
const CANALES={linkedin:'LinkedIn',meta_whatsapp:'Meta Ads / WhatsApp',directo:'Directo'};
const POR_PAGINA=50;
const fallo=e=>Object.assign(new Error(String(e?.message||e)),{causa:e});

// A qué etapas se puede pasar desde una: hacia delante, nunca atrás (la base lo rechaza igual), y
// «perdido» desde cualquiera. Desde «perdido» se puede reabrir a cualquiera.
// «perdido» va último en ETAPAS, así que «de la actual en adelante» ya lo incluye.
function etapasPosibles(actual){
 if(actual==='perdido')return [...ETAPAS];
 return ETAPAS.slice(Math.max(0,ETAPAS.indexOf(actual)));
}

// El teléfono va dentro de la clave de un lead de WhatsApp (wa:<número del negocio>:<cliente>) y el
// perfil, dentro de la de LinkedIn (li:<url>).
const telefonoDe=clave=>(/^wa:[0-9]+:([0-9]{7,20})$/.exec(String(clave||''))||[])[1]||'';
const linkedinDe=clave=>String(clave||'').startsWith('li:')?String(clave).slice(3):'';
// Un perfil de LinkedIn pegado en el buscador (con o sin https, www, / final, ?parámetros o #ancla),
// normalizado igual que lo guarda la base (lr_acrm_contactar). '' si no es una URL de perfil.
function perfilLinkedin(texto){
 let u=String(texto||'').trim().split('#')[0].split('?')[0].replace(/\/+$/,'').toLowerCase();
 u=u.replace(/^(https?:\/\/)?([a-z]{2,3}\.|www\.)?linkedin\.com\//,'https://www.linkedin.com/');
 return /^https:\/\/www\.linkedin\.com\/in\/[a-z0-9][a-z0-9_.%-]{1,180}$/.test(u)?u:'';
}

function lead(fila){
 const c=fila.lr_acrm_capturas||{};
 return {captura:fila.captura,canal:c.canal||'',nombre:c.nombre||'',capturadoEn:c.capturado_en||'',consulta:c.consulta||'',
  rubro:c.rubro||'',empresa:c.empresa||'',web:c.web||'',
  etapa:fila.etapa||'nuevo',version:fila.version,cotizacion:fila.cotizacion||'',monto:fila.monto==null?null:Number(fila.monto),
  movidoEn:fila.actualizado_en||'',telefono:telefonoDe(fila.captura),linkedin:linkedinDe(fila.captura),proxima:null};
}

// Rubro, empresa y web (migración 20261111100000) son columnas nuevas de la captura. Si todavía no
// está aplicada, PostgREST contesta 42703 y la tabla entera se quedaría en blanco: se vuelve a pedir
// sin esas tres columnas, igual que hacen los hitos con las suyas.
const COLUMNAS_EMBUDO='captura,etapa,version,cotizacion,monto,actualizado_en';
const COLUMNAS_CAPTURA='clave,canal,nombre,capturado_en,consulta';
const seleccion=conDatos=>`${COLUMNAS_EMBUDO},lr_acrm_capturas!inner(${COLUMNAS_CAPTURA}${conDatos?',rubro,empresa,web':''})`;
const sinColumnaDato=e=>String(e?.code||'')==='42703'||/does not exist/i.test(String(e?.message||''));

// Quién importó cada perfil de LinkedIn. Un lead de LinkedIn existe porque alguien del equipo subió
// su Connections.csv: saber de quién es la agenda explica por qué está en la lista, y si los dos lo
// tienen, salen los dos. Se lee de la tabla de cargas y no de la vista unificada, porque filtrar por
// URL ahí es un índice y en la vista es recorrer los miles de filas para agregarlas. Si no se puede
// leer, la tabla se dibuja igual sin ese dato: es un extra, no la fila.
async function marcarImportadores(client,leads){
 leads.forEach(l=>{l.importadoPor=[];});
 const perfiles=leads.filter(l=>l.linkedin).map(l=>l.linkedin);
 if(!perfiles.length)return leads;
 const r=await client.from('lr_pros_contactos_propios').select('linkedin_url,usuario_id').in('linkedin_url',perfiles);
 if(r.error){console.warn('ACRM: no se pudo leer quién importó cada perfil',r.error);return leads;}
 const por=new Map();
 for(const x of r.data||[]){
  const lista=por.get(x.linkedin_url)||[];
  if(!lista.includes(x.usuario_id))lista.push(x.usuario_id);
  por.set(x.linkedin_url,lista);
 }
 leads.forEach(l=>{if(l.linkedin)l.importadoPor=por.get(l.linkedin)||[];});
 return leads;
}

// filtro: 'todos' | una etapa | 'cotizados' (cotizado, ganado o perdido). canal: '' o uno de CANALES.
// porPagina: cuántas filas trae una página; es lo que elige la persona en la tabla (20, 50 o 100).
async function pagina(client,{filtro='todos',canal='',busqueda='',pagina:n=0,porPagina=POR_PAGINA}={}){
 // Los comodines de ilike se escapan: un «%» escrito en el buscador no puede traer toda la tabla.
 const texto=String(busqueda||'').trim().replace(/[\\%_]/g,m=>'\\'+m);
 // Una URL de perfil busca ese lead exacto: así lo encuentra quien tiene LinkedIn abierto al lado.
 const perfil=perfilLinkedin(busqueda);
 const tam=Math.max(1,Math.min(200,Number(porPagina)||POR_PAGINA));
 const desde=Math.max(0,n)*tam;
 const pedir=conDatos=>{
  let q=client.from('lr_acrm_embudo').select(seleccion(conDatos),{count:'exact'});
  if(filtro==='cotizados')q=q.in('etapa',['cotizado','ganado','perdido']);
  else if(ETAPAS.includes(filtro))q=q.eq('etapa',filtro);
  if(CANALES[canal])q=q.eq('lr_acrm_capturas.canal',canal);
  if(perfil)q=q.eq('captura','li:'+perfil);
  else if(texto)q=q.ilike('lr_acrm_capturas.nombre',`%${texto}%`);
  return q.order('actualizado_en',{ascending:false}).order('captura').range(desde,desde+tam-1);
 };
 let r=await pedir(true);
 if(r.error&&sinColumnaDato(r.error))r=await pedir(false);
 if(r.error)throw fallo(r.error);
 const leads=(r.data||[]).map(lead);
 // La próxima acción de cada lead en pantalla: la primera pendiente por fecha.
 const claves=leads.map(l=>l.captura);
 if(claves.length){
  const a=await client.from('lr_acrm_acciones').select('id,captura,accion,vence_en,tipo,responsable')
   .eq('estado','pendiente').in('captura',claves).order('vence_en');
  if(a.error)throw fallo(a.error);
  const primera=new Map();
  for(const x of a.data||[])if(!primera.has(x.captura))primera.set(x.captura,x);
  leads.forEach(l=>{l.proxima=primera.get(l.captura)||null;});
 }
 // Quién importó cada perfil de LinkedIn. Un lead de LinkedIn existe porque alguien del equipo subió
 // su Connections.csv: saber de quién es la agenda explica por qué está en la lista, y si los dos lo
 // tienen, salen los dos. Se lee de la tabla de cargas, no de la vista unificada, porque filtrar por
 // URL ahí es un índice y en la vista es recorrer los cuatro mil para agregar. Si no se puede leer,
 // la tabla se dibuja igual sin ese dato: es un extra, no la fila.
 await marcarImportadores(client,leads);
 return {leads,total:r.count??leads.length,pagina:n,porPagina:tam,desde,hayMas:desde+leads.length<(r.count??0)};
}

// Las cifras de arriba: cuántos leads hay por canal y cuántos siguen sin tocar. Son conteos sin
// filas (head), así que cuestan lo mismo con cuatro mil leads que con cuarenta.
async function resumen(client){
 const contar=async(tabla,filtrar=q=>q)=>{
  const r=await filtrar(client.from(tabla).select('*',{count:'exact',head:true}));
  if(r.error)throw fallo(r.error);
  return r.count||0;
 };
 const [total,linkedin,meta,directo,sinTocar]=await Promise.all([
  contar('lr_acrm_capturas'),
  contar('lr_acrm_capturas',q=>q.eq('canal','linkedin')),
  contar('lr_acrm_capturas',q=>q.eq('canal','meta_whatsapp')),
  contar('lr_acrm_capturas',q=>q.eq('canal','directo')),
  contar('lr_acrm_embudo',q=>q.eq('etapa','nuevo'))
 ]);
 return {total,porCanal:{linkedin,meta_whatsapp:meta,directo},sinTocar,contactados:Math.max(0,total-sinTocar)};
}

async function hilo(client,captura,limite=20){
 const r=await client.from('lr_acrm_mensajes').select('direccion,texto,enviado_en,autor,origen')
  .eq('captura',captura).order('enviado_en',{ascending:false}).limit(limite);
 if(r.error)throw fallo(r.error);
 return (r.data||[]).reverse();
}

// Todo lo que escribe pasa por lr_acrm_operar, la misma RPC que los botones de la cola.
const operar=async(client,accion,datos)=>{const r=await client.rpc('lr_acrm_operar',{p_accion:accion,p_datos:datos});if(r.error)throw fallo(r.error);return r.data;};
const cambiarEtapa=(client,l,etapa)=>operar(client,'etapa',{captura:l.captura,version:l.version,etapa});
// Un contacto hecho fuera (un mensaje por LinkedIn o una llamada) queda como mensaje enviado: es lo
// que mueve el embudo a «contactado» y lo que cuenta la racha del marcador.
const registrarContacto=(client,l,texto)=>operar(client,'mensaje',{captura:l.captura,direccion:'enviado',texto:String(texto||'').trim().slice(0,4000)});
const programar=(client,l,{accion,venceEn,responsable})=>operar(client,'crear',{captura:l.captura,accion:String(accion||'').trim().slice(0,240),vence_en:venceEn,responsable});

// Un lead suelto, para abrir su ficha aunque no esté en la página que se ve (desde la cola o el agente).
async function uno(client,captura){
 const pedir=conDatos=>client.from('lr_acrm_embudo').select(seleccion(conDatos)).eq('captura',captura).maybeSingle();
 let r=await pedir(true);
 if(r.error&&sinColumnaDato(r.error))r=await pedir(false);
 if(r.error)throw fallo(r.error);
 if(!r.data)return null;
 const uno=lead(r.data);
 await marcarImportadores(client,[uno]);
 return uno;
}

// Rubro, empresa y web de un lead: los tres datos con los que se decide si vale la pena escribirle.
// Van por su propia función y no por lr_acrm_operar, así que no hace falta reescribir la operación
// que ya mueve etapas, mensajes y cotizaciones. Se mandan los tres juntos: la función los pisa.
async function guardarDatos(client,l,cambios={}){
 const campo=(clave,largo)=>String(cambios[clave]??l[clave]??'').trim().slice(0,largo);
 const r=await client.rpc('lr_acrm_datos',{p_datos:{captura:l.captura,
  rubro:campo('rubro',120),empresa:campo('empresa',200),web:campo('web',300)}});
 if(r.error&&sinFuncion(r.error))throw new Error('Rubro, empresa y web necesitan la migración 20261111100000_acrm_rubro_empresa_web.sql aplicada en Supabase');
 if(r.error)throw fallo(r.error);
 return r.data;
}

// Lo que la ficha muestra además de la fila: todas las acciones pendientes del lead (la tabla solo
// enseña la primera), quién es quién en el equipo y, si es de LinkedIn, la reserva del primer
// contacto, que es lo que impide que dos personas le escriban a la misma.
// Sin la migración 20261110070000 la tabla no tiene mensaje ni canal: se leen los hitos sin ellos
// en vez de dejar la ficha sin hitos.
const COLUMNAS_HITO='id,accion,vence_en,tipo,responsable,version,estado,completado_en';
const sinColumnasHito=e=>/mensaje|canal|42703|does not exist/i.test(String(e?.code||'')+' '+String(e?.message||''));
async function leerHitos(client,captura){
 const pedir=columnas=>client.from('lr_acrm_acciones').select(columnas).eq('captura',captura).in('estado',['pendiente','hecha']).order('vence_en').limit(60);
 const r=await pedir(COLUMNAS_HITO+',mensaje,canal');
 return r.error&&sinColumnasHito(r.error)?pedir(COLUMNAS_HITO):r;
}
async function detalle(client,l){
 const [acciones,equipo,reserva]=await Promise.all([
  // Los hitos: los pendientes y los últimos cumplidos, con su mensaje y su canal.
  leerHitos(client,l.captura),
  client.from('lr_pros_colaboradores').select('usuario_id,nombre').eq('activo',true),
  l.linkedin?client.from('lr_acrm_contactos').select('linkedin_url,responsable,estado,version,contactado_por,contactado_en').eq('linkedin_url',l.linkedin).maybeSingle():Promise.resolve({data:null})
 ]);
 for(const r of [acciones,equipo,reserva])if(r.error)throw fallo(r.error);
 return {acciones:acciones.data||[],equipo:equipo.data||[],reserva:reserva.data||null};
}

const completarAccion=(client,a)=>operar(client,'completar',{id:a.id,version:a.version});

// El bot de WhatsApp (migración 20261110090000): quién atiende la conversación de un lead que llegó
// por WhatsApp, y el botón para que el equipo la tome o la devuelva. Sin la migración, la ficha
// simplemente no muestra el bloque (null), en vez de romperse.
const esLeadWhatsapp=captura=>/^wa:[0-9]+:[0-9]{7,20}$/.test(String(captura||''));
const sinFuncion=e=>/PGRST202|could not find the function/i.test(String(e?.code||'')+' '+String(e?.message||''));
async function botEstado(client,captura){
 if(!esLeadWhatsapp(captura))return null;
 const r=await client.rpc('lr_acrm_bot_estado',{p_captura:captura});
 if(r.error&&sinFuncion(r.error))return null;
 if(r.error)throw fallo(r.error);
 return r.data||null;
}
// La tabla: si el bot está prendido, cuántas citas agendó hoy y en qué va con cada lead de WhatsApp.
async function botTablero(client,capturas){
 const wa=[...new Set((capturas||[]).filter(esLeadWhatsapp))].slice(0,200);
 const r=await client.rpc('lr_acrm_bot_tablero',{p_capturas:wa});
 if(r.error&&sinFuncion(r.error))return null;
 if(r.error)throw fallo(r.error);
 return r.data||null;
}
const BOT_FASE={respondiendo:'Respondiendo',buscando:'Buscando cita',agendada:'Cita agendada',humano:'Control humano',cerrada:'Conversación cerrada',sin_chat:'Sin chat'};
// El WhatsApp de cualquier lead con teléfono, no solo de los que escribieron por WhatsApp: un
// número de Perú de 9 dígitos que empieza en 9 se completa con el 51. '' si no hay número usable.
function waDe(telefono){
 let d=String(telefono||'').replace(/\D/g,'');
 if(/^9\d{8}$/.test(d))d='51'+d;
 return /^\d{7,20}$/.test(d)?d:'';
}
// La clave con la que el bot conoce la conversación. Los leads de WhatsApp ya la tienen; para los
// demás se arma con el número (el 0 de en medio no se usa: las funciones del bot solo leen el número).
function claveWhatsapp(captura,telefono){
 if(esLeadWhatsapp(captura))return captura;
 const wa=waDe(telefono);
 return wa?`wa:0:${wa}`:'';
}
// La conversación de WhatsApp que guarda la Agenda para ese número (cliente, asistente y equipo).
// null si la Agenda no está o la cuenta no la puede leer: la ficha muestra entonces solo el hilo.
async function chatWhatsapp(client,wa){
 if(!wa)return null;
 const r=await client.rpc('lr_suite_agenda_chat',{p_wa_id:wa,p_limite:60});
 if(r.error)return null;
 return Array.isArray(r.data?.mensajes)?r.data.mensajes:[];
}
async function botControl(client,captura,humano){
 const r=await client.rpc('lr_acrm_bot_control',{p_captura:captura,p_humano:!!humano});
 if(r.error&&sinFuncion(r.error))throw new Error('El bot necesita la migración 20261110090000_acrm_bot_whatsapp.sql aplicada en Supabase');
 if(r.error)throw fallo(r.error);
 return r.data;
}

// Los hitos: acciones con su mensaje y su canal (migración 20261110070000), por su propia operación.
const CANALES_HITO=['linkedin','whatsapp','llamada','correo','reunion'];
const hito=async(client,accion,datos)=>{
 const r=await client.rpc('lr_acrm_hito',{p_accion:accion,p_datos:datos});
 if(r.error&&/PGRST202|could not find the function/i.test(String(r.error.code||'')+' '+String(r.error.message||'')))
  throw new Error('Los hitos necesitan la migración 20261110070000_acrm_hitos.sql aplicada en Supabase');
 if(r.error)throw fallo(r.error);
 return r.data;
};
function crearHito(client,l,{accion,venceEn,mensaje='',canal='',responsable=null}){
 const datos={captura:l.captura,accion:String(accion||'').trim().slice(0,240),vence_en:venceEn,mensaje:String(mensaje||'').trim().slice(0,4000),canal:CANALES_HITO.includes(canal)?canal:''};
 if(responsable)datos.responsable=responsable;
 return hito(client,'crear',datos);
}
function editarHito(client,a,cambios){
 const datos={id:a.id,version:a.version};
 if(cambios.accion!==undefined)datos.accion=String(cambios.accion).trim().slice(0,240);
 if(cambios.venceEn!==undefined)datos.vence_en=cambios.venceEn;
 if(cambios.mensaje!==undefined)datos.mensaje=String(cambios.mensaje).trim().slice(0,4000);
 if(cambios.canal!==undefined)datos.canal=CANALES_HITO.includes(cambios.canal)?cambios.canal:'';
 return hito(client,'editar',datos);
}
// Cumplir un hito: su mensaje queda en el hilo como enviado (mueve el embudo y cuenta para la racha)
// y la acción se cierra. El primer contacto de LinkedIn no: ese se cierra con la reserva.
async function cumplirHito(client,l,a,texto=''){
 if(a.tipo==='primer_contacto')throw new Error('El primer contacto de LinkedIn se cierra con «Ya envié el mensaje»');
 const enviado=String(texto||a.mensaje||'').trim();
 if(enviado)await registrarContacto(client,l,enviado);
 return completarAccion(client,a);
}
const reprogramar=(client,a,{accion,venceEn})=>operar(client,'editar',{id:a.id,version:a.version,accion:String(accion||'').trim().slice(0,240),vence_en:venceEn});
// La reserva de LinkedIn: reservar antes de escribir, confirmar al enviar (eso cierra el primer
// contacto de la cola y mueve el embudo) o cancelar si no se envió.
async function contactar(client,l,accion,{responsable=null,version=0}={}){
 if(!['reservar','confirmar','cancelar','asignar'].includes(accion))throw new Error('Acción de reserva desconocida');
 const r=await client.rpc('lr_acrm_contactar',{p_url:l.linkedin,p_accion:accion,p_responsable:responsable,p_version:version});
 if(r.error)throw fallo(r.error);
 return r.data;
}

// ── Acompañar la navegación de LinkedIn ────────────────────────────────────
// Quien escribe por LinkedIn es la persona (LinkedIn no permite que un bot mande mensajes), pero
// quien lleva la cuenta puede ser Claude in Chrome mirando la pantalla. Para que eso funcione, el
// ACRM necesita una sola operación por mensaje —«a este perfil le envié este texto»— en vez de la
// secuencia de buscar, abrir la ficha, reservar y confirmar. Esto es esa operación.

// A quién me toca escribirle: mis primeros contactos pendientes de LinkedIn (los que reparte el
// marcador). Sin la migración de hitos no hay columna «mensaje»: se leen sin ella, igual que en la
// ficha.
//
// Se sugiere solo a quien NO tiene ningún mensaje enviado registrado. Un perfil entra al ACRM
// porque alguien del equipo subió su Connections.csv, no porque esté sin contactar: puede haberle
// escrito el otro (o uno mismo) antes de que existiera esta pantalla, y la tarea de primer contacto
// sigue abierta hasta que alguien cierra la reserva. Sugerirlo sería mandar el segundo «hola» de la
// agencia a la misma persona. Por eso se descartan también los perfiles reservados o ya contactados
// por otra persona: a esos no se les escribe, se los deja a quien los tiene.
// Devuelve la lista con `.descartados` (cuántos se filtraron), para poder decirlo en pantalla.
const COLUMNAS_COLA='id,captura,accion,vence_en';
async function colaLinkedin(client,{limite=20}={}){
 const sesion=await client.auth.getUser();
 const yo=sesion?.data?.user?.id||'';
 const vacia=Object.assign([],{descartados:0});
 if(!yo)return vacia;
 // Se piden más de los que se muestran: los que ya tienen mensajes se caen y hay que reponerlos.
 const tope=Math.max(1,Math.min(50,Number(limite)||20));
 const pedir=columnas=>client.from('lr_acrm_acciones').select(columnas)
  .eq('estado','pendiente').eq('tipo','primer_contacto').eq('responsable',yo)
  .order('vence_en').limit(Math.min(100,tope*3));
 let r=await pedir(COLUMNAS_COLA+',mensaje,lr_acrm_capturas!inner(nombre)');
 if(r.error&&sinColumnasHito(r.error))r=await pedir(COLUMNAS_COLA+',lr_acrm_capturas!inner(nombre)');
 if(r.error)throw fallo(r.error);
 const filas=(r.data||[]).filter(a=>String(a.captura||'').startsWith('li:'));
 if(!filas.length)return vacia;
 const capturas=filas.map(a=>a.captura);
 const [res,msg]=await Promise.all([
  client.from('lr_acrm_contactos').select('linkedin_url,estado,responsable').in('linkedin_url',capturas.map(c=>c.slice(3))),
  client.from('lr_acrm_mensajes').select('captura').eq('direccion','enviado').in('captura',capturas)
 ]);
 for(const x of [res,msg])if(x.error)throw fallo(x.error);
 const reservas=new Map((res.data||[]).map(x=>[x.linkedin_url,x]));
 const escritos=new Set((msg.data||[]).map(x=>x.captura));
 const cola=[];
 let descartados=0;
 for(const a of filas){
  const url=a.captura.slice(3);
  const reserva=reservas.get(url)||null;
  const ajeno=reserva?.responsable&&reserva.responsable!==yo;
  if(escritos.has(a.captura)||reserva?.estado==='contactado'||ajeno){descartados++;continue;}
  if(cola.length<tope)cola.push({captura:a.captura,url,nombre:a.lr_acrm_capturas?.nombre||'',accion:a.accion||'',
   venceEn:a.vence_en||'',mensaje:a.mensaje||'',estado:reserva?.estado||'',mia:true});
 }
 return Object.assign(cola,{descartados});
}

// «A este perfil le envié este mensaje», en una sola llamada: encuentra el lead por su URL, cierra
// la reserva del primer contacto si todavía estaba abierta (eso da la atribución y cierra el hito)
// y deja el texto en el hilo como mensaje enviado, que es lo que mueve el embudo y la
// contactabilidad. Si el perfil es de otra persona, no registra nada: avisa y se detiene.
async function registrarEnvioLinkedin(client,{url,mensaje}={}){
 const perfil=perfilLinkedin(url);
 if(!perfil)throw new Error('Esa no es la URL de un perfil de LinkedIn (linkedin.com/in/…). La de la conversación no sirve.');
 const texto=String(mensaje||'').trim();
 if(texto.length<2)throw new Error('Falta el texto del mensaje que se envió.');
 const captura='li:'+perfil;
 const [sesion,encontrado,reserva]=await Promise.all([
  client.auth.getUser(),
  uno(client,captura),
  client.from('lr_acrm_contactos').select('linkedin_url,responsable,estado,version,contactado_por,contactado_en').eq('linkedin_url',perfil).maybeSingle()
 ]);
 if(reserva.error)throw fallo(reserva.error);
 if(!encontrado)throw new Error('Ese perfil no está en el ACRM: cárgalo con el Connections.csv antes de registrar su mensaje.');
 const yo=sesion?.data?.user?.id||'';
 const r=reserva.data;
 const lead={...encontrado,linkedin:perfil};
 let primerContacto=false;
 if(r?.estado!=='contactado'){
  if(r?.responsable&&r.responsable!==yo){
   throw new Error(r.estado==='reservado'
    ?'Otra persona tiene reservado este perfil: no se registra, para no cruzar mensajes.'
    :'Este perfil está asignado a otro compañero: que lo libere antes de escribirle.');
  }
  let version=Number(r?.version||0);
  if(r?.estado!=='reservado'){
   const reservado=await contactar(client,lead,'reservar',{version});
   version=Number(reservado?.version??version+1);
  }
  await contactar(client,lead,'confirmar',{version});
  primerContacto=true;
 }
 await registrarContacto(client,lead,texto);
 // Quién hizo el primer contacto viaja de vuelta: si fue otra persona, el seguimiento que se acaba
 // de registrar entra en una conversación que empezó alguien más y conviene decirlo en pantalla.
 return {captura,perfil,nombre:lead.nombre||'',etapaAnterior:lead.etapa||'',primerContacto,
  primeroDe:primerContacto?yo:(r?.contactado_por||''),primeroEn:primerContacto?'':(r?.contactado_en||'')};
}

// Quién es quién en el equipo, para poder decir «lo contactó Diego» en vez de un uuid.
async function equipo(client){
 const r=await client.from('lr_pros_colaboradores').select('usuario_id,nombre').eq('activo',true);
 if(r.error)throw fallo(r.error);
 return r.data||[];
}

window.LRACRMLeads={pagina,resumen,uno,detalle,hilo,cambiarEtapa,guardarDatos,registrarContacto,programar,completarAccion,reprogramar,contactar,colaLinkedin,registrarEnvioLinkedin,equipo,crearHito,editarHito,cumplirHito,CANALES_HITO,botEstado,botControl,botTablero,BOT_FASE,esLeadWhatsapp,perfilLinkedin,waDe,claveWhatsapp,chatWhatsapp,etapasPosibles,telefonoDe,linkedinDe,ETAPAS,ETAPA_TEXTO,CANALES,POR_PAGINA};
})();
