(function(){
"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lima=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(' ','T');
const fresh=a=>a.ia_en&&Date.now()-new Date(a.ia_en).getTime()<86400000;
let root,client,channel,timer,epoch=0,loading=false,dirty=false,busy=false,loaded=false,me='',members=[],tasks=[],pacing=[],owner='',month=lima(new Date()).slice(0,7),notice='',error='',draft=null,expanded=false;
// El marcador del mes y la etapa de cada prospecto de la cola. El embudo no se lee entero —son
// miles de contactos de LinkedIn— sino solo el de las acciones que están en pantalla.
let marcador={canales:[],personas:[]},etapas=new Map(),leads=[];
const ETAPAS=['nuevo','contactado','respondio','cotizado','ganado','perdido'];
const ETAPA_TEXTO={nuevo:'Sin tocar',contactado:'Contactado',respondio:'Respondió',cotizado:'Cotizado',ganado:'Ganado',perdido:'Perdido'};
function ordered(items){return [...items].sort((a,b)=>((fresh(b)?b.prioridad_ia:-1)-(fresh(a)?a.prioridad_ia:-1))||new Date(a.vence_en)-new Date(b.vence_en)||a.id.localeCompare(b.id));}
function render(){
 if(!root?.isConnected)return;
 // Los indicadores y el mes viven en la barra del título del módulo, fuera del panel.
 const resumen=document.getElementById('lrAcrmResumen');
 // Do not replace a form while the user is typing.
 const activo=document.activeElement;
 if((root.contains(activo)||resumen?.contains(activo))&&['INPUT','TEXTAREA','SELECT'].includes(activo?.tagName))return;
 const channels={linkedin:'LinkedIn',meta_whatsapp:'Meta Ads / WhatsApp'};
 const visible=ordered(tasks.filter(t=>!owner||t.responsable===owner));
 const opciones=sel=>members.map(m=>`<option value="${esc(m.usuario_id)}" ${sel===m.usuario_id?'selected':''}>${esc(m.nombre)}${me===m.usuario_id?' · yo':''}</option>`).join('');
 const estado=p=>({sin:!p.meta,cumplida:p.meta&&p.capturados>=p.meta,lenta:p.meta&&p.capturados<p.meta&&p.capturados<p.esperados});
 const ritmoTexto=p=>{
  const {sin,cumplida}=estado(p);
  const base=sin?'Define una meta':cumplida?`Meta de ${p.meta} alcanzada`:`Faltan ${p.faltan} · ${p.por_dia===null?'periodo cerrado':p.por_dia+' por día'}`;
  return base+(p.canal==='meta_whatsapp'?` · ${p.capturados?p.desde_anuncio+' con atribución de anuncio':'Sin eventos recibidos'}`:'');
 };
 // Indicador mínimo para la barra del título: rótulo, cifra y aviso solo si el ritmo va corto.
 const indicador=p=>{
  const {sin,lenta}=estado(p);
  return `<span class="acrm-kpi" title="${esc(channels[p.canal]+' · perfiles únicos incorporados este mes · '+ritmoTexto(p))}">
   <span class="acrm-kpi-label">${channels[p.canal]}</span>
   <strong>${p.capturados}${sin?'':`<span class="acrm-kpi-goal"> / ${p.meta}</span>`}</strong>
   ${lenta?'<span class="badge amber">Por debajo</span>':''}
  </span>`;
 };
 // Meta editable y ritmo completo, al pie junto a las demás acciones poco frecuentes.
 const meta=p=>`<div class="acrm-meta">
  <p class="small"><strong>${channels[p.canal]}</strong> · ${p.capturados} capturados${estado(p).lenta?' · Por debajo del ritmo':estado(p).cumplida?' · Meta cumplida':p.meta?' · En ritmo':''}</p>
  <progress max="${p.meta||Math.max(1,p.capturados)}" value="${p.meta?Math.min(p.meta,p.capturados):0}" aria-label="Captura ${channels[p.canal]}"></progress>
  <p class="small muted">${ritmoTexto(p)}</p>
  <form data-goal="${esc(p.canal)}"><input aria-label="Meta ${channels[p.canal]}" type="number" min="0" max="100000" step="1" value="${p.meta}" required><button class="btn" ${busy?'disabled':''}>Guardar</button></form>
 </div>`;
 // Fila de acción con la misma estructura que las citas de Agenda: nombre, apoyo y botones.
 const fila=t=>{
  const captura=t.lr_acrm_capturas||{},mia=t.responsable===me,ahora=new Date(t.vence_en)<new Date();
  const cuando=new Date(t.vence_en).toLocaleString('es-PE',{timeZone:'America/Lima',dateStyle:'short',timeStyle:'short'});
  const wa=captura.canal==='meta_whatsapp'&&/^wa:[0-9]+:[0-9]{7,20}$/.test(t.captura);
  return `<div class="acrm-task">
   <div class="acrm-task-main">
    <strong>${esc(captura.nombre||'Prospecto')}</strong>
    <p class="small">${esc(t.accion)}</p>
    <p class="small muted">${esc(cuando)}${channels[captura.canal]?' · '+channels[captura.canal]:''} · ${fresh(t)?'IA · '+esc(t.motivo_ia):'Por fecha · pendiente de priorizar con IA'}</p>
    ${captura.canal==='meta_whatsapp'?`<details class="acrm-consulta"><summary>Consulta</summary><p class="small">${esc(captura.consulta)}</p></details>`:''}
   </div>
   ${(()=>{const e=etapas.get(t.captura);return e&&e.etapa!=='nuevo'?`<span class="acrm-etapa" title="Etapa en el embudo">${esc(ETAPA_TEXTO[e.etapa]||e.etapa)}</span>`:'';})()}
   ${ahora?'<span class="badge amber">Pendiente para ahora</span>':''}
   <div class="acrm-task-actions">${captura.canal==='linkedin'?`<button class="btn" type="button" data-open="${t.id}">Ver contacto</button>`:''}${mia?`${wa?`<a class="btn" target="_blank" rel="noopener noreferrer" href="https://wa.me/${t.captura.split(':')[2]}">Abrir WhatsApp</a>`:''}${t.tipo!=='primer_contacto'?`<button class="btn" type="button" data-done="${t.id}" ${busy?'disabled':''}>Hecha</button>`:''}<button class="btn" type="button" data-edit="${t.id}">Editar</button>`:''}<button class="btn" type="button" data-next="${t.id}">+ Seguimiento</button></div>
  </div>`;
 };
 // El embudo de un canal: cuántos llegaron a cada paso este mes y qué porcentaje pasó del anterior.
 // Las barras se miden contra el primer paso, que es el único número que no depende de otro.
 const embudo=c=>{
  const pasos=[['Contactados',c.contactados],['Respondieron',c.respondieron],['Cotizados',c.cotizados],['Ganados',c.ganados]];
  const tope=Math.max(1,c.contactados);
  const salto=(antes,ahora)=>antes>0?Math.round(ahora*100/antes)+'%':'—';
  return `<div class="acrm-canal">
   <p>${esc(channels[c.canal]||c.canal)}${c.sin_tocar?` · ${c.sin_tocar} sin tocar`:''}${Number(c.monto_ganado)>0?` · S/ ${Number(c.monto_ganado).toLocaleString('es-PE')} ganados`:''}</p>
   <div class="acrm-pasos">${pasos.map(([etiqueta,valor],i)=>
    (i?`<div class="acrm-salto" title="Conversión del paso anterior">${salto(pasos[i-1][1],valor)}</div>`:'')+
    `<div class="acrm-paso"><b>${valor}</b><i><em style="width:${Math.round(Math.min(1,valor/tope)*100)}%"></em></i><span title="${esc(etiqueta)}">${esc(etiqueta)}</span></div>`
   ).join('')}</div>
  </div>`;
 };
 const lider=(marcador.personas||[]).find(p=>p.mensajes>0);
 const ranking=(marcador.personas||[]).map(p=>`<tr>
  <td>${esc(p.nombre)}${lider&&p.usuario_id===lider.usuario_id?'<span class="acrm-lider">va ganando</span>':''}</td>
  <td><span class="acrm-racha${p.racha?'':' fria'}">${p.racha?`${p.racha} ${p.racha===1?'día':'días'}`:'sin racha'}</span></td>
  <td>${p.mensajes}</td><td>${p.prospectos}</td><td>${p.cotizados}</td><td>${p.ganados}</td>
 </tr>`).join('');
 if(resumen)resumen.innerHTML=`${pacing.map(indicador).join('')}<input aria-label="Mes de captura" id="acrmMonth" type="month" value="${esc(month)}">`;
 // Sin embudo todavía —la migración no aplicada— el marcador no se dibuja: una tarjeta vacía solo
 // haría pensar que no se ha trabajado este mes.
 const hayMarcador=(marcador.canales||[]).length||ranking;
 root.innerHTML=`${hayMarcador?`<div class="panel">
  <div class="panel-head"><strong>Marcador del mes</strong><span class="research-muted">${esc(marcador.mes||month)}</span></div>
  <div class="acrm-embudo">${(marcador.canales||[]).map(embudo).join('')}</div>
  ${ranking?`<table class="acrm-ranking"><thead><tr><th>Quién</th><th>Racha</th><th>Mensajes</th><th>Prospectos</th><th>Cotizados</th><th>Ganados</th></tr></thead><tbody>${ranking}</tbody></table>`:''}
 </div>`:''}
 <div class="panel">
  <div class="panel-head acrm-panel-head"><strong>Próximas acciones</strong><div class="acrm-tools"><select id="acrmOwner" aria-label="Filtrar responsable"><option value="">Todos</option>${opciones(owner)}</select><button class="btn primary" type="button" id="acrmPrioritize" ${busy?'disabled':''}>${busy?'Procesando…':'Priorizar con IA'}</button></div></div>
  ${error?`<p class="acrm-msg err" role="alert">${esc(error)}</p>`:''}${notice?`<p class="acrm-msg" role="status">${esc(notice)}</p>`:''}
  ${members.filter(m=>!owner||m.usuario_id===owner).map(m=>{const own=visible.filter(t=>t.responsable===m.usuario_id),show=expanded?own:own.slice(0,5);return `<p class="acrm-owner-head">${esc(m.nombre)}<span>${own.length} pendientes</span></p>${own.length?show.map(fila).join(''):'<p class="empty">Sin acciones pendientes.</p>'}`;}).join('')}
  <div class="acrm-foot">
   <div><p class="small">La IA ordena hasta 30 acciones próximas por persona. No envía mensajes.</p><details><summary>Metas mensuales y ritmo de captura</summary><div class="acrm-metas">${pacing.map(meta).join('')}</div></details><details><summary>Preparar cola por fecha</summary><p class="small">Completa hasta 5 acciones por persona con perfiles disponibles de LinkedIn. Respeta las reservas y asignaciones.</p><button class="btn" type="button" id="acrmPrepare" ${busy?'disabled':''}>Preparar sin IA</button></details></div>
   <button class="btn" type="button" id="acrmExpand">${expanded?'Ver menos':'Ver todas'}</button>
  </div>
 </div>
 ${draft?`<div class="panel" role="dialog" aria-label="Editar seguimiento"><div class="panel-head"><strong>${draft.id?'Editar seguimiento':'Nuevo seguimiento'} · ${esc(draft.nombre)}</strong></div><form id="acrmTaskForm"><div class="acrm-form"><label class="acrm-field"><span>Acción</span><input name="accion" required minlength="3" maxlength="240" value="${esc(draft.accion)}"></label><label class="acrm-field"><span>Fecha y hora · Lima</span><input name="fecha" type="datetime-local" required value="${esc(draft.fecha)}"></label><label class="acrm-field"><span>Responsable</span><select name="responsable" ${draft.id?'disabled':''}>${opciones(draft.responsable)}</select></label><div class="acrm-field acrm-form-actions"><button class="btn primary" ${busy?'disabled':''}>Guardar</button><button type="button" class="btn" id="acrmCancelEdit">Cancelar</button></div></div></form></div>`:''}`;
 const mes=resumen?.querySelector('#acrmMonth');
 if(mes)mes.onchange=e=>{month=e.target.value;load();};
 root.querySelector('#acrmOwner').onchange=e=>{owner=e.target.value;e.target.blur();render();};
 root.querySelector('#acrmPrioritize').onclick=prioritize;
 root.querySelector('#acrmPrepare').onclick=()=>operate('preparar',{},'Cola preparada por fecha, sin IA.');
 root.querySelector('#acrmExpand').onclick=()=>{expanded=!expanded;render();};
 root.querySelectorAll('[data-goal]').forEach(f=>f.onsubmit=e=>{e.preventDefault();f.querySelector('input').blur();operate('meta',{mes:month+'-01',canal:f.dataset.goal,objetivo:Number(f.querySelector('input').value)},'Meta guardada para el equipo.');});
 const get=id=>tasks.find(t=>t.id===id);
 root.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{const t=get(b.dataset.open);window.LRProsContactosPropios.focusContact(t.captura.slice(3));});
 root.querySelectorAll('[data-done]').forEach(b=>b.onclick=()=>{const t=get(b.dataset.done);operate('completar',{id:t.id,version:t.version},'Acción completada.');});
 root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const t=get(b.dataset.edit);draft={...t,nombre:t.lr_acrm_capturas?.nombre,fecha:lima(new Date(t.vence_en))};render();});
 root.querySelectorAll('[data-next]').forEach(b=>b.onclick=()=>{const t=get(b.dataset.next);openNew(t.captura,t.lr_acrm_capturas?.nombre,t.responsable);});
 const form=root.querySelector('#acrmTaskForm');
 if(form){
  form.oninput=()=>{draft.accion=form.elements.accion.value;draft.fecha=form.elements.fecha.value;draft.responsable=form.elements.responsable.value;};
  form.onsubmit=e=>{e.preventDefault();document.activeElement?.blur();const data={...draft,vence_en:new Date(draft.fecha+':00-05:00').toISOString()};operate(draft.id?'editar':'crear',data,'Seguimiento guardado.',true);};
  root.querySelector('#acrmCancelEdit').onclick=()=>{draft=null;render();};
 }
}
async function load(){
 if(!client||!root?.isConnected)return;
 if(loading||busy){dirty=true;return;}loading=true;const generation=epoch,active=client;
 try{
  const [p,a,m,u]=await Promise.all([active.rpc('lr_acrm_pacing',{p_mes:month+'-01'}),active.from('lr_acrm_acciones').select('*,lr_acrm_capturas(nombre,canal,consulta)').eq('estado','pendiente').order('vence_en').limit(1000),active.from('lr_pros_colaboradores').select('usuario_id,nombre').eq('activo',true),active.auth.getUser()]);
  for(const r of [p,a,m,u])if(r.error)throw r.error;
  // El embudo y el marcador son la parte comercial, y llegaron después: si la migración todavía no
  // está aplicada la cola tiene que seguir funcionando igual, sin marcador y sin etapas.
  // Los leads de WhatsApp se leen enteros aunque no tengan acción pendiente: son pocos y su clave
  // lleva el teléfono, que es con lo que se enganchan las cotizaciones. Los de LinkedIn no: son
  // miles y no hay teléfono con el que emparejar nada.
  const l=await active.from('lr_acrm_capturas').select('clave,nombre,capturado_en,consulta').eq('canal','meta_whatsapp').order('capturado_en',{ascending:false}).limit(400);
  // Solo las etapas de lo que se va a usar: leer las 4.000 del embudo cada 15 s no tiene sentido.
  const claves=[...new Set([...(a.data||[]).map(t=>t.captura),...(l.data||[]).map(x=>x.clave)])];
  const [s,f]=await Promise.all([
   active.rpc('lr_acrm_marcador',{p_mes:month+'-01'}),
   claves.length?active.from('lr_acrm_embudo').select('captura,etapa,version,cotizacion,monto').in('captura',claves):Promise.resolve({data:[]})
  ]);
  if(epoch!==generation)return;pacing=p.data||[];tasks=a.data||[];members=m.data||[];me=u.data.user.id;
  marcador=!s.error&&s.data&&typeof s.data==='object'?s.data:{canales:[],personas:[]};
  etapas=f.error?new Map():new Map((f.data||[]).map(x=>[x.captura,x]));
  leads=l.error?[]:(l.data||[]);
  if(s.error||f.error||l.error)console.warn('ACRM: el embudo todavía no está disponible.',s.error?.message||f.error?.message||l.error?.message);
  loaded=true;
 }catch(e){if(epoch===generation)error='No se pudo actualizar el tablero: '+String(e.message||e);}
 finally{if(epoch===generation){loading=false;render();if(dirty){dirty=false;load();}}}
}
async function operate(action,data,msg,close=false){
 if(busy)return;busy=true;error='';render();
 try{const r=await client.rpc('lr_acrm_operar',{p_accion:action,p_datos:data});if(r.error)throw r.error;notice=msg;if(close)draft=null;}
 catch(e){error=String(e.message||e);}finally{busy=false;await load();render();}
}
async function prioritize(){
 if(busy)return;busy=true;error='';notice='Claude está revisando las próximas acciones…';render();
 try{const r=await client.functions.invoke('acrm-priorizar',{body:{}});if(r.error){let detail;try{detail=await r.error.context?.json();}catch{}throw Error(detail?.error||r.error.message);}if(r.data?.error)throw Error(r.data.error);notice=r.data.mensaje||'Prioridades actualizadas.';}
 catch(e){error=String(e.message||e);notice='Se conserva el orden anterior. Puedes preparar la cola por fecha sin IA.';}
 finally{busy=false;await load();render();}
}
// ── Puerta del agente IA ───────────────────────────────────────────────────
// Lo único que el agente de este módulo ve y lo único que puede pedir. No lee la base por su
// cuenta ni toca el estado interno: mira esta foto y, para cambiar algo, pasa por las mismas
// operaciones que los botones del panel, con el mismo candado de «ocupado» y el mismo aviso.
function snapshot(){
 const ahora=new Date();
 return {
  // `abierto` dice que el módulo está en pantalla; `cargado`, que ya llegó la primera lectura.
  // Sin lo segundo la cola se vería vacía y el agente diría que no hay nada que hacer.
  abierto:Boolean(root?.isConnected&&client),cargado:loaded,
  mes:month,yo:me,filtro:owner,
  pacing:pacing.map(p=>({canal:p.canal,meta:p.meta,capturados:p.capturados,esperados:p.esperados,faltan:p.faltan,por_dia:p.por_dia,desde_anuncio:p.desde_anuncio})),
  colaboradores:members.map(m=>({id:m.usuario_id,nombre:m.nombre})),
  marcador:{canales:marcador.canales||[],personas:marcador.personas||[]},
  // Los leads de WhatsApp del mes, con o sin acción pendiente: su clave trae el teléfono, que es
  // por donde se enganchan con las cotizaciones.
  leads:leads.map(x=>{
   const e=etapas.get(x.clave)||null;
   return {captura:x.clave,nombre:x.nombre,telefono:x.clave.split(':')[2]||'',capturado_en:x.capturado_en,
    consulta:x.consulta||'',etapa:e?.etapa||'nuevo',etapa_version:e?.version??null,
    cotizacion:e?.cotizacion||'',monto:e?.monto??null};
  }),
  acciones:ordered(tasks).map(t=>{
   const e=etapas.get(t.captura)||null;
   return {
    id:t.id,captura:t.captura,accion:t.accion,tipo:t.tipo,responsable:t.responsable,
    vence_en:t.vence_en,vencida:new Date(t.vence_en)<ahora,
    prioridad:fresh(t)?t.prioridad_ia:null,motivo:fresh(t)?t.motivo_ia:'',
    nombre:t.lr_acrm_capturas?.nombre||'',canal:t.lr_acrm_capturas?.canal||'',
    consulta:t.lr_acrm_capturas?.consulta||'',
    etapa:e?.etapa||'nuevo',etapa_version:e?.version??null,cotizacion:e?.cotizacion||'',monto:e?.monto??null
   };
  })
 };
}
// El hilo de un prospecto. Se lee a pedido y no en cada refresco: son los mensajes de una
// conversación, y cargarlos todos cada quince segundos sería pagar egress por nada.
async function agentHilo(captura,limite=30){
 const impedimento=agentReady();
 if(impedimento)return {ok:false,motivo:impedimento};
 const {data,error:fallo}=await client.from('lr_acrm_mensajes')
  .select('direccion,texto,enviado_en,autor,origen').eq('captura',captura)
  .order('enviado_en',{ascending:false}).limit(Math.min(60,Math.max(1,limite)));
 if(fallo)return {ok:false,motivo:'No se pudo leer el hilo: '+fallo.message};
 const quien=id=>members.find(m=>m.usuario_id===id)?.nombre||'';
 return {ok:true,mensajes:(data||[]).reverse().map(m=>({
  direccion:m.direccion,texto:m.texto,cuando:m.enviado_en,origen:m.origen,
  de:m.direccion==='enviado'?quien(m.autor):'el prospecto'
 }))};
}
function agentReady(){
 if(!client||!root?.isConnected)return 'El panel del ACRM ya no está abierto.';
 if(busy)return 'El panel está ocupado con otra operación; prueba de nuevo en un momento.';
 return '';
}
// La versión de la fila la pone el panel, no el agente: así una acción que cambió mientras se
// conversaba no se pisa con un dato viejo.
function agentTask(id){return tasks.find(t=>t.id===id)||null;}
async function agentRun(action,data,msg){
 const impedimento=agentReady();
 if(impedimento)return {ok:false,motivo:impedimento};
 await operate(action,data,msg);
 return error?{ok:false,motivo:error}:{ok:true,nota:msg};
}
async function agentPrioritize(){
 const impedimento=agentReady();
 if(impedimento)return {ok:false,motivo:impedimento};
 await prioritize();
 return error?{ok:false,motivo:error}:{ok:true,nota:notice};
}
// Abrir la ficha no es solo mover la pantalla: devuelve empresa, cargo y ubicación, que es lo que
// el agente necesita para escribir un primer mensaje que no parezca una plantilla.
async function agentFocus(id){
 const t=agentTask(id);
 if(!t)return {ok:false,motivo:'Esa acción ya no está en la cola.'};
 if(t.lr_acrm_capturas?.canal!=='linkedin')return {ok:false,motivo:'Esa acción no es de LinkedIn: no tiene ficha de contacto que abrir.'};
 const lista=window.LRProsContactosPropios;
 if(!lista?.focusContact)return {ok:false,motivo:'La lista de contactos no está cargada.'};
 const url=t.captura.slice(3),nombre=t.lr_acrm_capturas?.nombre||'el contacto';
 if(!lista.focusContactInfo){lista.focusContact(url);return {ok:true,nota:'Se abrió la ficha de '+nombre+'.'};}
 const ficha=await lista.focusContactInfo(url);
 if(!ficha)return {ok:true,nota:'Se abrió la ficha de '+nombre+', pero la lista no devolvió sus datos: puede estar actualizándose.'};
 return {ok:true,ficha,nota:'Ficha de '+nombre+[ficha.empresa&&' · '+ficha.empresa,ficha.cargo&&' · '+ficha.cargo].filter(Boolean).join('')+'.'};
}
function openNew(captura,nombre,responsable=me){draft={captura,nombre,responsable,accion:'Dar seguimiento a la consulta',fecha:lima(new Date(Date.now()+86400000))};render();root.querySelector('#acrmTaskForm')?.scrollIntoView({block:'center',behavior:'smooth'});}
function unmount(){epoch++;loaded=false;if(channel&&client)client.removeChannel(channel);clearInterval(timer);const resumen=document.getElementById('lrAcrmResumen');if(resumen)resumen.innerHTML='';channel=null;root=null;loading=false;}
function mount(element,supabase){unmount();root=element;client=supabase;if(!client)return;error='';load();channel=client.channel('acrm-plan-'+crypto.randomUUID());for(const table of ['lr_acrm_capturas','lr_acrm_metas','lr_acrm_acciones','lr_acrm_embudo','lr_acrm_mensajes'])channel.on('postgres_changes',{event:'*',schema:'public',table},()=>load());channel.subscribe(s=>{if(s==='SUBSCRIBED')load();});timer=setInterval(()=>{if(!root?.isConnected){unmount();return;}if(!document.hidden)load();},15000);}
window.LRACRM={mount,unmount,openNew,ordered,snapshot,agentTask,agentRun,agentPrioritize,agentFocus,agentHilo,ETAPAS,ETAPA_TEXTO};
})();
