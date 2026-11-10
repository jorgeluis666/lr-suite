// El agente de la ficha de cada lead: lo que el navegador le cuenta y cómo lee lo que propone.
//
// El modelo vive en la función acrm-ficha y solo propone; aplicar es cosa de la ficha (index.html,
// acrmLeadsModule), por las mismas operaciones que sus botones. Este archivo es el protocolo entre
// los dos y no toca la pantalla ni la base, para poder probarse:
//   · ficha(): el texto con lo que la persona ve del lead, que es todo lo que el modelo sabe.
//   · leer(): de la respuesta, el texto para mostrar y las propuestas con su id.
//   · validar(): si una propuesta se puede aplicar en esta ficha, antes de ofrecer el botón.
//   · siguiente(): el turno nuevo, que empieza contándole al modelo qué pasó con cada propuesta
//     (la API exige responder cada tool_use antes de seguir).
(function(){
"use strict";
const ETAPAS=['nuevo','contactado','respondio','cotizado','ganado','perdido'];
const ETAPA_TEXTO={nuevo:'Sin tocar',contactado:'Contactado',respondio:'Respondió',cotizado:'Cotizado',ganado:'Ganado',perdido:'Perdido'};
const ESTADOS=['Enviado','En revisión','Aprobado','Perdido'];
const SERVICIOS=['Google Ads','Meta Ads','Google Ads + Meta Ads','Diseño de Landing Page','Diseño de Página Web','Diseño de E-Commerce','Otro servicio'];
const SOLO_CON_COTIZACION=new Set(['estado_cotizacion','contacto','telefono','email','servicio','monto','fecha_envio']);
const CAMPO_TEXTO={etapa:'Etapa',estado_cotizacion:'Estado de la cotización',contacto:'Contacto',telefono:'Teléfono',email:'Correo',servicio:'Servicio',monto:'Monto cotizado',fecha_envio:'Fecha de envío'};
const limpio=(v,n=300)=>String(v??'').replace(/[\u0000-\u001f]+/g,' ').trim().slice(0,n);
const CANALES=['linkedin','whatsapp','correo','llamada','reunion'];
const CANAL_TEXTO={linkedin:'LinkedIn',whatsapp:'WhatsApp',correo:'Correo',llamada:'Llamada',reunion:'Reunión'};
const NOMBRES=['proponer_cambio','registrar_contacto','proponer_hito','completar_hito'];
const fechaLima=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':new Date(d.getTime()-5*3600000).toISOString().slice(0,16).replace('T',' ');};
const pasada=f=>new Date(String(f).slice(0,16)+':00-05:00').getTime()<Date.now()-3600000;

// lead: fila de la tabla maestra; cotizacion: la de la pantalla (o null); hilo: mensajes del lead.
function ficha({lead,cotizacion,hilo=[],hitos=[],quien=''}){
 const l=lead||{},q=cotizacion;
 const lineas=[
  `Lead: ${limpio(q?.cliente||l.nombre||'sin nombre')} · captura ${limpio(l.captura,500)}`,
  `Canal: ${limpio(l.canal)} · etapa: ${ETAPA_TEXTO[l.etapa]||limpio(l.etapa)}`,
  l.telefono?`Teléfono del canal: +${limpio(l.telefono,30)}`:'',
  l.linkedin?`Perfil de LinkedIn: ${limpio(l.linkedin,500)}`:'',
  l.consulta?`Consulta con la que llegó: «${limpio(l.consulta,1000)}»`:'',
  l.proxima?`Próxima acción: ${limpio(l.proxima.accion)} · vence ${limpio(l.proxima.vence_en,40)}`:'Próxima acción: ninguna',
  q?[
   `Cotización ${limpio(q.id,120)}: ${limpio(q.estado)} · servicio ${limpio(q.servicioEstandar||q.servicio)} · S/ ${Number(q.montoCotizado)||0}`,
   `  enviada: ${limpio(q.fechaEnvio,10)||'sin fecha'} · contactos de seguimiento hechos: ${Number(q.contactosRealizados)||0} de 8`,
   `  contacto: ${limpio(q.contacto)||'—'} · teléfono: ${limpio(q.telefono,60)||'—'} · correo: ${limpio(q.emailContacto,200)||'—'}`
  ].join('\n'):'Sin cotización: solo se pueden proponer etapa, contacto registrado y tarea.',
  quien?`Quien mira la ficha: ${limpio(quien,80)}`:''
 ].filter(Boolean);
 const mensajes=(Array.isArray(hilo)?hilo:[]).slice(-20).map(m=>`- ${m.direccion==='enviado'?'Enviado':'Recibido'} ${limpio(m.enviado_en,25)}: ${limpio(m.texto,600)}`);
 const lista=Array.isArray(hitos)?hitos:[];
 const pendientes=lista.filter(h=>h.estado!=='hecha').map(h=>`- [id ${limpio(h.id,60)}] ${fechaLima(h.vence_en)} · ${CANAL_TEXTO[h.canal]||'sin canal'} · ${limpio(h.accion,240)}${h.tipo==='primer_contacto'?' (primer contacto: se cierra con la reserva)':''}\n  mensaje: ${h.mensaje?`«${limpio(h.mensaje,800)}»`:'SIN MENSAJE'}`);
 const cumplidos=lista.filter(h=>h.estado==='hecha').slice(-8).map(h=>`- ${fechaLima(h.completado_en||h.vence_en)} · ${CANAL_TEXTO[h.canal]||'—'} · ${limpio(h.accion,240)}`);
 return lineas.join('\n')
  +`\n\nHitos pendientes (${pendientes.length}):\n${pendientes.join('\n')||'- ninguno: hay que armar el plan'}`
  +`\n\nHitos cumplidos (${cumplidos.length}):\n${cumplidos.join('\n')||'- ninguno'}`
  +`\n\nHilo (${mensajes.length} últimos mensajes):\n${mensajes.join('\n')||'- sin mensajes registrados'}`;
}

// De los bloques de la respuesta: el texto que se muestra y las propuestas, con el id que la API
// necesita para recibir su resultado.
function leer(contenido){
 const bloques=Array.isArray(contenido)?contenido:[];
 const texto=bloques.filter(b=>b?.type==='text').map(b=>String(b.text||'')).join('\n').trim();
 const propuestas=bloques.filter(b=>b?.type==='tool_use'&&NOMBRES.includes(b.name))
  .map(b=>({id:String(b.id),nombre:b.name,datos:b.input&&typeof b.input==='object'?b.input:{},estado:'pendiente',detalle:''}));
 const buscadas=bloques.filter(b=>b?.type==='server_tool_use'&&b.name==='web_search').length;
 return {texto,propuestas,buscadas};
}

// Lo que impide aplicar una propuesta en esta ficha, o '' si se puede. Se mira antes de ofrecer el
// botón: el modelo propone dentro de un catálogo cerrado, pero no se le cree a ciegas.
function validar(p,{lead,cotizacion,hitos=[],yo=''}){
 const d=p?.datos||{};
 const fechaValida=f=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(f||''));
 if(p?.nombre==='registrar_contacto')return limpio(d.texto,4000).length>=3?'':'Falta qué se le dijo.';
 if(p?.nombre==='proponer_hito'){
  if(!CANALES.includes(d.canal))return 'Canal desconocido.';
  if(!fechaValida(d.fecha))return 'La fecha no tiene el formato AAAA-MM-DDTHH:MM.';
  if(pasada(d.fecha))return 'La fecha ya pasó.';
  if(limpio(d.accion,240).length<3)return 'Falta el rótulo del hito.';
  if(d.canal!=='llamada'&&limpio(d.mensaje,4000).length<3)return 'Falta el mensaje.';
  return '';
 }
 if(p?.nombre==='completar_hito'){
  const h=(Array.isArray(hitos)?hitos:[]).find(x=>x.id===d.id&&x.estado!=='hecha');
  if(!h)return 'Ese hito ya no está pendiente en la ficha.';
  if(yo&&h.responsable!==yo)return 'Ese hito es de otra persona: solo su responsable lo edita.';
  if(d.canal===undefined&&d.fecha===undefined&&d.mensaje===undefined)return 'No dice qué completar.';
  if(d.canal!==undefined&&!CANALES.includes(d.canal))return 'Canal desconocido.';
  if(d.fecha!==undefined&&(!fechaValida(d.fecha)||pasada(d.fecha)))return 'La fecha no es válida o ya pasó.';
  if(d.mensaje!==undefined&&limpio(d.mensaje,4000).length<3)return 'El mensaje está vacío.';
  return '';
 }
 if(p?.nombre!=='proponer_cambio')return 'Propuesta desconocida.';
 const campo=String(d.campo||''),valor=limpio(d.valor,300);
 if(!CAMPO_TEXTO[campo])return 'Ese dato no se puede cambiar desde aquí.';
 if(SOLO_CON_COTIZACION.has(campo)&&!cotizacion)return 'Ese dato vive en la cotización y este lead no tiene.';
 if(campo==='etapa'){
  if(!ETAPAS.includes(valor))return 'Etapa desconocida.';
  const actual=lead?.etapa||'nuevo';
  if(actual!=='perdido'&&ETAPAS.indexOf(valor)<ETAPAS.indexOf(actual))return `El embudo no retrocede: ya está en «${ETAPA_TEXTO[actual]}».`;
  if(valor===actual)return 'Ya está en esa etapa.';
  if(valor==='cotizado'&&!cotizacion)return 'Para pasar a «Cotizado» hay que crear la cotización.';
 }
 if(campo==='estado_cotizacion'&&!ESTADOS.includes(valor))return 'Estado desconocido.';
 if(campo==='servicio'&&!SERVICIOS.includes(valor))return 'Servicio fuera del catálogo.';
 if(campo==='monto'&&!(Number(valor.replace(',','.'))>=0&&valor!==''))return 'El monto no es un número.';
 if(campo==='fecha_envio'&&!/^\d{4}-\d{2}-\d{2}$/.test(valor))return 'La fecha no tiene el formato AAAA-MM-DD.';
 if(campo==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor))return 'El correo no parece válido.';
 return '';
}

// El texto corto que se muestra en la tarjeta de la propuesta.
function resumen(p){
 const d=p?.datos||{};
 if(p?.nombre==='registrar_contacto')return `Registrar contacto: «${limpio(d.texto,200)}»`;
 if(p?.nombre==='proponer_hito')return `Hito · ${CANAL_TEXTO[d.canal]||d.canal}: ${limpio(d.accion,240)} · ${limpio(d.fecha,16).replace('T',' ')}`;
 if(p?.nombre==='completar_hito')return `Completar hito: ${[d.canal!==undefined&&`canal ${CANAL_TEXTO[d.canal]||d.canal}`,d.fecha!==undefined&&`fecha ${limpio(d.fecha,16).replace('T',' ')}`,d.mensaje!==undefined&&'mensaje'].filter(Boolean).join(', ')}`;
 const valor=d.campo==='etapa'?(ETAPA_TEXTO[d.valor]||d.valor):d.campo==='monto'?`S/ ${limpio(d.valor,30)}`:limpio(d.valor,200);
 return `${CAMPO_TEXTO[d.campo]||d.campo}: ${valor}`;
}

// El turno siguiente. Si el último del asistente propuso algo, primero van los resultados —uno por
// propuesta, aplicada, descartada o sin decidir—, después el texto de la persona.
function siguiente(mensajes,propuestas,texto){
 const previos=Array.isArray(mensajes)?mensajes:[];
 const ultimo=previos[previos.length-1];
 const pendientes=ultimo?.role==='assistant'&&Array.isArray(ultimo.content)?ultimo.content.filter(b=>b?.type==='tool_use'):[];
 const porId=new Map((propuestas||[]).map(p=>[p.id,p]));
 const resultados=pendientes.map(b=>{
  const p=porId.get(b.id);
  const estado=p?.estado||'pendiente';
  const contenido=estado==='aplicada'?'Aplicada por la persona.':estado==='descartada'?'La persona la descartó.':estado==='error'?`No se pudo aplicar: ${limpio(p?.detalle,300)}`:'La persona todavía no decidió.';
  return {type:'tool_result',tool_use_id:b.id,content:contenido,...(estado==='error'?{is_error:true}:{})};
 });
 const contenido=[...resultados,{type:'text',text:limpio(texto,2000)||'Sigue.'}];
 return [...previos,{role:'user',content:contenido}];
}

window.LRACRMFicha={ficha,leer,validar,resumen,siguiente,CAMPO_TEXTO,CANALES,CANAL_TEXTO,ETAPAS,ESTADOS,SERVICIOS};
})();
