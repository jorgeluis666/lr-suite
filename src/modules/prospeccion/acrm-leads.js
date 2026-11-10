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

function lead(fila){
 const c=fila.lr_acrm_capturas||{};
 return {captura:fila.captura,canal:c.canal||'',nombre:c.nombre||'',capturadoEn:c.capturado_en||'',consulta:c.consulta||'',
  etapa:fila.etapa||'nuevo',version:fila.version,cotizacion:fila.cotizacion||'',monto:fila.monto==null?null:Number(fila.monto),
  movidoEn:fila.actualizado_en||'',telefono:telefonoDe(fila.captura),linkedin:linkedinDe(fila.captura),proxima:null};
}

// filtro: 'todos' | una etapa | 'cotizados' (cotizado, ganado o perdido). canal: '' o uno de CANALES.
async function pagina(client,{filtro='todos',canal='',busqueda='',pagina:n=0}={}){
 let q=client.from('lr_acrm_embudo')
  .select('captura,etapa,version,cotizacion,monto,actualizado_en,lr_acrm_capturas!inner(clave,canal,nombre,capturado_en,consulta)',{count:'exact'});
 if(filtro==='cotizados')q=q.in('etapa',['cotizado','ganado','perdido']);
 else if(ETAPAS.includes(filtro))q=q.eq('etapa',filtro);
 if(CANALES[canal])q=q.eq('lr_acrm_capturas.canal',canal);
 // Los comodines de ilike se escapan: un «%» escrito en el buscador no puede traer toda la tabla.
 const texto=String(busqueda||'').trim().replace(/[\\%_]/g,m=>'\\'+m);
 if(texto)q=q.ilike('lr_acrm_capturas.nombre',`%${texto}%`);
 const desde=Math.max(0,n)*POR_PAGINA;
 const r=await q.order('actualizado_en',{ascending:false}).order('captura').range(desde,desde+POR_PAGINA-1);
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
 return {leads,total:r.count??leads.length,pagina:n,porPagina:POR_PAGINA,hayMas:desde+leads.length<(r.count??0)};
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
 const r=await client.from('lr_acrm_embudo')
  .select('captura,etapa,version,cotizacion,monto,actualizado_en,lr_acrm_capturas!inner(clave,canal,nombre,capturado_en,consulta)')
  .eq('captura',captura).maybeSingle();
 if(r.error)throw fallo(r.error);
 return r.data?lead(r.data):null;
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

window.LRACRMLeads={pagina,resumen,uno,detalle,hilo,cambiarEtapa,registrarContacto,programar,completarAccion,reprogramar,contactar,crearHito,editarHito,cumplirHito,CANALES_HITO,etapasPosibles,telefonoDe,linkedinDe,ETAPAS,ETAPA_TEXTO,CANALES,POR_PAGINA};
})();
