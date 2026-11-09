(function(){
"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lima=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(' ','T');
const fresh=a=>a.ia_en&&Date.now()-new Date(a.ia_en).getTime()<86400000;
let root,client,channel,timer,epoch=0,loading=false,dirty=false,busy=false,me='',members=[],tasks=[],pacing=[],owner='',month=lima(new Date()).slice(0,7),notice='',error='',draft=null,expanded=false;
function ordered(items){return [...items].sort((a,b)=>((fresh(b)?b.prioridad_ia:-1)-(fresh(a)?a.prioridad_ia:-1))||new Date(a.vence_en)-new Date(b.vence_en)||a.id.localeCompare(b.id));}
function render(){
 if(!root?.isConnected)return;
 // Do not replace a form while the user is typing.
 if(root.contains(document.activeElement)&&['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;
 const channels={linkedin:'LinkedIn',meta_whatsapp:'Meta Ads / WhatsApp'};
 const visible=ordered(tasks.filter(t=>!owner||t.responsable===owner));
 root.innerHTML=`<div class="acrm-heading"><div><h2>Captura y seguimiento</h2><small>Perfiles únicos incorporados · mes en Lima</small></div><input aria-label="Mes de captura" id="acrmMonth" type="month" value="${esc(month)}"></div>
 <div class="acrm-pacing">${pacing.map(p=>`<article><div>${channels[p.canal]} <strong>${p.capturados}${p.meta?' / '+p.meta:''}</strong></div><progress max="${p.meta||Math.max(1,p.capturados)}" value="${p.meta?Math.min(p.meta,p.capturados):0}" aria-label="Captura ${channels[p.canal]}"></progress><small>${!p.meta?'Define una meta':p.capturados>=p.meta?'Meta cumplida':`${p.capturados<p.esperados?'Por debajo del ritmo':'En ritmo'} · faltan ${p.faltan} · ${p.por_dia===null?'Periodo cerrado':p.por_dia+'/día'}`}${p.canal==='meta_whatsapp'?` · ${p.capturados?p.desde_anuncio+' con atribución de anuncio':'Sin eventos recibidos'}`:''}</small><details><summary>Meta mensual</summary><form data-goal="${p.canal}"><input aria-label="Meta ${channels[p.canal]}" type="number" min="0" max="100000" step="1" value="${p.meta}" required><button class="action" ${busy?'disabled':''}>Guardar</button></form></details></article>`).join('')}</div>
 <div class="acrm-heading"><h3>Próximas acciones</h3><div><select id="acrmOwner" aria-label="Filtrar responsable"><option value="">Todos</option>${members.map(m=>`<option value="${esc(m.usuario_id)}" ${owner===m.usuario_id?'selected':''}>${esc(m.nombre)}${me===m.usuario_id?' · yo':''}</option>`).join('')}</select> <button class="action primary" id="acrmPrioritize" ${busy?'disabled':''}>${busy?'Procesando…':'Priorizar con IA'}</button></div></div>
 ${error?`<p class="research-msg err" role="alert">${esc(error)}</p>`:''}${notice?`<p role="status" class="research-muted">${esc(notice)}</p>`:''}
 ${members.filter(m=>!owner||m.usuario_id===owner).map(m=>{const own=visible.filter(t=>t.responsable===m.usuario_id),show=expanded?own:own.slice(0,5);return `<section class="acrm-owner"><b>${esc(m.nombre)}</b> <small>${own.length} pendientes</small>${show.map(t=>`<div class="acrm-task"><div><strong>${esc(t.lr_acrm_capturas?.nombre||'Prospecto')}</strong> · ${esc(t.accion)}<small>${esc(new Date(t.vence_en).toLocaleString('es-PE',{timeZone:'America/Lima',dateStyle:'short',timeStyle:'short'}))} · ${channels[t.lr_acrm_capturas?.canal]||''}${new Date(t.vence_en)<new Date()?' · Pendiente para ahora':''}<br>${fresh(t)?'IA · '+esc(t.motivo_ia):'Por fecha · pendiente de priorizar con IA'}</small></div>${t.lr_acrm_capturas?.canal==='meta_whatsapp'?`<details><summary>Consulta</summary><p>${esc(t.lr_acrm_capturas?.consulta)}</p></details>`:''}<div class="acrm-task-actions">${t.lr_acrm_capturas?.canal==='linkedin'?`<button class="action" data-open="${t.id}">Ver contacto</button>`:''}${t.responsable===me?`${t.lr_acrm_capturas?.canal==='meta_whatsapp'&&/^wa:[0-9]+:[0-9]{7,20}$/.test(t.captura)?`<a class="action" target="_blank" rel="noopener noreferrer" href="https://wa.me/${t.captura.split(':')[2]}">Abrir WhatsApp</a>`:''}${t.tipo!=='primer_contacto'?`<button class="action" data-done="${t.id}" ${busy?'disabled':''}>Hecha</button>`:''}<button class="action" data-edit="${t.id}">Editar</button>`:''}<button class="action" data-next="${t.id}">+ Seguimiento</button></div></div>`).join('')}${!own.length?'<p class="research-muted">Sin acciones pendientes.</p>':''}</section>`}).join('')}
 <div class="acrm-heading"><small>La IA ordena hasta 30 acciones próximas por persona. No envía mensajes.</small><button class="action" id="acrmExpand">${expanded?'Ver menos':'Ver todas'}</button></div>
 <details><summary>Preparar cola por fecha</summary><p class="research-muted">Completa hasta 5 acciones por persona con perfiles disponibles de LinkedIn. Respeta las reservas y asignaciones.</p><button class="action" id="acrmPrepare" ${busy?'disabled':''}>Preparar sin IA</button></details>
 ${draft?`<div class="acrm-edit" role="dialog" aria-label="Editar seguimiento"><form id="acrmTaskForm"><strong>${esc(draft.nombre)}</strong><label>Acción<input name="accion" required minlength="3" maxlength="240" value="${esc(draft.accion)}"></label><label>Fecha y hora · Lima<input name="fecha" type="datetime-local" required value="${esc(draft.fecha)}"></label><label>Responsable<select name="responsable" ${draft.id?'disabled':''}>${members.map(m=>`<option value="${esc(m.usuario_id)}" ${draft.responsable===m.usuario_id?'selected':''}>${esc(m.nombre)}</option>`).join('')}</select></label><button class="action primary" ${busy?'disabled':''}>Guardar</button><button type="button" class="action" id="acrmCancelEdit">Cancelar</button></form></div>`:''}`;
 root.querySelector('#acrmMonth').onchange=e=>{month=e.target.value;load();};
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
  if(epoch!==generation)return;pacing=p.data||[];tasks=a.data||[];members=m.data||[];me=u.data.user.id;
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
function openNew(captura,nombre,responsable=me){draft={captura,nombre,responsable,accion:'Dar seguimiento a la consulta',fecha:lima(new Date(Date.now()+86400000))};render();root.querySelector('#acrmTaskForm')?.scrollIntoView({block:'center',behavior:'smooth'});}
function unmount(){epoch++;if(channel&&client)client.removeChannel(channel);clearInterval(timer);channel=null;root=null;loading=false;}
function mount(element,supabase){unmount();root=element;client=supabase;if(!client)return;error='';load();channel=client.channel('acrm-plan-'+crypto.randomUUID());for(const table of ['lr_acrm_capturas','lr_acrm_metas','lr_acrm_acciones'])channel.on('postgres_changes',{event:'*',schema:'public',table},()=>load());channel.subscribe(s=>{if(s==='SUBSCRIBED')load();});timer=setInterval(()=>{if(!root?.isConnected){unmount();return;}if(!document.hidden)load();},15000);}
window.LRACRM={mount,unmount,openNew,ordered};
})();
