(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LRClientesIngreso = api;
})(typeof window === 'undefined' ? this : window, function () {
  'use strict';
  const PREFIX = 'cliente-ingreso:';
  const STEPS = [
    ['alta', 'Alta del cliente', 'Objetivos, servicios y responsable confirmados'],
    ['accesos', 'Accesos y fuentes', 'Accesos comprobados en Nexus'],
    ['configuracion', 'Configuración', 'Módulos, fuentes y mapeos revisados'],
    ['validacion', 'Validación', 'Datos contrastados con el origen'],
    ['activacion', 'Activación', 'Tablero y primera sincronización verificados'],
    ['seguimiento', 'Seguimiento', 'Responsable y rutina de revisión acordados']
  ];
  const STATES = { pendiente: 'Pendiente', en_curso: 'En curso', bloqueado: 'Bloqueado', completo: 'Completo', no_aplica: 'No aplica' };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize = v => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  function newKey(name) {
    const slug = normalize(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug || slug.length > 100) throw new Error('Usa un nombre de cliente de hasta 100 caracteres.');
    return 'nuevo-' + slug;
  }
  function text(v, max, label) {
    if (typeof v !== 'string' || v.length > max || /[\x00-\x08\x0b-\x1f\x7f]/.test(v)) throw new Error(label + ' no válido.');
    return v.trim();
  }
  function validate(input) {
    const name = text(input.nombre, 100, 'Nombre');
    if (!name) throw new Error('Indica el nombre del cliente.');
    const data = { version: 1, nombre: name };
    for (const [key, max] of Object.entries({responsable:100, contacto:200, servicios:500, objetivos:1000, modulos:500, nexus_empresa:100, nexus_cuentas:300})) {
      data[key] = text(input[key] || '', max, key);
    }
    data.checklist = {};
    for (const [key] of STEPS) {
      const item = input.checklist?.[key] || {};
      if (!Object.hasOwn(STATES, item.estado || 'pendiente')) throw new Error('Estado de checklist no válido.');
      const state = item.estado || 'pendiente';
      const note = text(item.nota || '', 500, 'Evidencia');
      if (['completo', 'no_aplica', 'bloqueado'].includes(state) && !note) throw new Error('Añade evidencia o motivo para las etapas completas, bloqueadas o que no aplican.');
      data.checklist[key] = { estado: state, responsable: text(item.responsable || '', 100, 'Responsable'), nota: note };
    }
    if (data.checklist.alta.estado === 'completo' && (!data.responsable || !data.objetivos || !data.servicios)) throw new Error('Completa responsable, objetivos y servicios antes de cerrar el alta.');
    if (data.checklist.activacion.estado === 'completo' && STEPS.slice(0,4).some(([key]) => !['completo','no_aplica'].includes(data.checklist[key].estado))) throw new Error('Resuelve las etapas anteriores antes de completar la activación.');
    return data;
  }
  function progress(data) {
    const items = STEPS.map(([key]) => data?.checklist?.[key]?.estado || 'pendiente');
    const done = items.filter(s => ['completo','no_aplica'].includes(s)).length;
    const next = items.findIndex(s => !['completo','no_aplica'].includes(s));
    return { done, total: STEPS.length, blocked: items.includes('bloqueado'), next: next < 0 ? 'Ingreso completado' : STEPS[next][1] };
  }
  function catalog(projects, rows) {
    const clients = new Map();
    const names = new Set();
    for (const p of projects) {
      if (p.cliente === 'Lima Retail' || names.has(normalize(p.cliente))) continue;
      names.add(normalize(p.cliente));
      const key = p.repo || p.clave;
      if (key) clients.set(key, { key, nombre:p.cliente, existing:true });
    }
    for (const row of rows) {
      if (!row.key.startsWith(PREFIX)) continue;
      const key = row.key.slice(PREFIX.length), saved = row.payload;
      if (!saved || typeof saved.nombre !== 'string') continue;
      if (!clients.has(key) && names.has(normalize(saved.nombre))) continue;
      const old = clients.get(key);
      clients.set(key, {key, nombre:old?.nombre || saved.nombre, existing:!!old, data:saved, row});
      names.add(normalize(saved.nombre));
    }
    return [...clients.values()].sort((a,b) => a.nombre.localeCompare(b.nombre,'es'));
  }
  async function load(client) {
    const result = await client.from('lr_suite_private_data').select('key,payload,updated_at').like('key', PREFIX + '%').order('key').limit(501);
    if (result.error) throw new Error('No se pudieron leer las fichas. Comprueba tu sesión y vuelve a intentar.');
    if (result.data.length > 500) throw new Error('El catálogo requiere paginación antes de seguir creciendo.');
    return result.data;
  }
  async function save(client, key, input, previous) {
    if (!/^[A-Za-z0-9._-]{1,150}$/.test(key)) throw new Error('Identificador de cliente no válido.');
    const payload = validate(input);
    const updated_at = new Date(Math.max(Date.now(), (Date.parse(previous?.updated_at) || 0) + 1)).toISOString();
    const table = client.from('lr_suite_private_data');
    // Compare-and-swap: a stale tab must never overwrite another user's checklist.
    const query = previous
      ? table.update({payload,updated_at}).eq('key',PREFIX+key).eq('updated_at',previous.updated_at)
      : table.insert({key:PREFIX+key,payload,updated_at});
    const result = await query.select('key,payload,updated_at');
    if (result.error?.code === '23505' || (!result.error && result.data?.length !== 1)) throw new Error('La ficha cambió en otra sesión. Recarga las fichas antes de guardar; tus cambios siguen en el formulario.');
    if (result.error) throw new Error('No se pudo guardar la ficha. Conservamos tus cambios en el formulario.');
    return result.data[0];
  }
  async function mount(container, options) {
    if (!container) return;
    container.innerHTML = '<p role="status">Leyendo fichas de clientes…</p>';
    let rows, clients, current = null;
    const client = options.client;
    try { if (!client) throw new Error('Inicia sesión para gestionar las fichas.'); rows = await load(client); }
    catch (error) { container.innerHTML = '<p role="alert">'+esc(error.message)+'</p><button type="button" data-retry>Reintentar</button>'; container.querySelector('[data-retry]').onclick=()=>mount(container,options); return; }
    if (!container.isConnected) return;
    clients = catalog(options.projects,rows);
    options.onLoad?.(rows);
    function list() {
      container.dataset.dirty = 'false';
      container.innerHTML = `<div class="ingreso-toolbar"><div><h2>Ficha única e ingreso</h2><p>Una ficha por cliente. Los accesos y mapas existentes se conservan.</p></div><button type="button" data-new>Nuevo cliente</button></div>
        <p class="small">El checklist es una revisión del equipo; no reemplaza el diagnóstico técnico de Nexus.</p>
        <label>Buscar cliente <input type="search" data-search placeholder="Nombre del cliente"></label>
        <div class="ingreso-list">${clients.map(c=>{const p=progress(c.data);return `<button type="button" data-open="${esc(c.key)}"><strong>${esc(c.nombre)}</strong><span>${p.done}/${p.total} etapas · ${p.blocked?'Bloqueado · ':''}${esc(p.next)}</span><span>${esc(c.data?.responsable || 'Sin responsable')}</span></button>`;}).join('')}</div>`;
      container.querySelector('[data-new]').onclick=()=>edit(null);
      container.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>edit(clients.find(c=>c.key===b.dataset.open)));
      container.querySelector('[data-search]').oninput=e=>container.querySelectorAll('[data-open]').forEach(b=>b.hidden=!normalize(b.textContent).includes(normalize(e.target.value)));
    }
    function edit(c) {
      current = c;
      container.dataset.dirty = 'false';
      const d = c?.data || {}, fields = [['responsable','Responsable del cliente',100],['contacto','Contacto del cliente',200],['servicios','Servicios acordados',500],['objetivos','Objetivos',1000],['modulos','Módulos de LR Suite',500],['nexus_empresa','Espacio de trabajo en Nexus',100],['nexus_cuentas','IDs de cuentas en Nexus',300]];
      container.innerHTML = `<form class="ingreso-form"><h2>${c?'Ficha de '+esc(c.nombre):'Nuevo cliente'}</h2><p class="small">${c?'ID estable: '+esc(c.key):'Se crea una ficha privada; no hace falta crear primero un repositorio.'}</p>
        <label>Nombre del cliente <input name="nombre" maxlength="100" required value="${esc(c?.nombre||'')}" ${c?'readonly':''}></label>
        <div class="ingreso-fields">${fields.map(([key,label,max])=>`<label>${label}<textarea name="${key}" maxlength="${max}" rows="2">${esc(d[key]||'')}</textarea></label>`).join('')}</div>
        <p class="small">La referencia a Nexus se registra manualmente. No enlaza cuentas ni comparte credenciales. No guardes contraseñas aquí.</p>
        <a href="https://nexus.limaretail.com/connections#diagnostico" target="_blank" rel="noopener noreferrer">Abrir diagnóstico en Nexus</a>
        <h3>Checklist de ingreso</h3><div class="ingreso-checklist">${STEPS.map(([key,label,help],i)=>{const item=d.checklist?.[key]||{};return `<fieldset><legend>${i+1}. ${label}</legend><p class="small">${help}</p><label>Estado <select name="${key}_estado">${Object.entries(STATES).map(([v,l])=>`<option value="${v}" ${v===(item.estado||'pendiente')?'selected':''}>${l}</option>`).join('')}</select></label><label>Responsable <input name="${key}_responsable" maxlength="100" value="${esc(item.responsable||'')}"></label><label>Evidencia o motivo <textarea name="${key}_nota" maxlength="500" rows="2">${esc(item.nota||'')}</textarea></label></fieldset>`;}).join('')}</div>
        <p role="status" data-message></p><div class="ingreso-toolbar"><button type="submit">Guardar ficha</button><button type="button" data-back>Volver a fichas</button><button type="button" data-reload>Recargar fichas</button></div>
        <section class="ingreso-supervisor"><h3>Supervisor del ingreso</h3><p>Revisa la ficha guardada. No cambia etapas ni envía mensajes. Nexus y WhatsApp requieren evidencia adicional.</p>
        <div class="ingreso-toolbar"><button type="button" data-review="reglas">Revisar checklist · Sin IA</button><button type="button" data-review="ia">Pedir recomendaciones IA</button><button type="button" data-agent>Configurar en Agentes IA</button></div>
        <p class="small">Las recomendaciones consumen API y tokens, registrados como supervisor en Agentes IA. Guarda primero los cambios.</p><div data-review-result aria-live="polite"></div></section></form>`;
      let dirty=false, saving=false;
      const form=container.querySelector('form');
      let reviewing=false;
      container.querySelector('[data-agent]').onclick=async()=>{if(!saving&&!reviewing&&leave()){try{await options.openAgent?.();}catch{container.querySelector('[data-review-result]').textContent='No se pudo abrir Agentes IA. Revisa tu sesión.';}}};
      container.querySelectorAll('[data-review]').forEach(button=>button.onclick=async()=>{
        const output=container.querySelector('[data-review-result]');
        if(dirty || !current?.row){output.textContent='Guarda la ficha antes de revisarla.';return;}
        if(reviewing||saving)return;
        if(!options.review){output.textContent='El supervisor no está disponible en este entorno.';return;}
        reviewing=true;container.dataset.saving='true';form.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);
        output.textContent='Revisando la ficha guardada…';
        try {
          const result=await options.review({cliente:current.key,version:current.row.updated_at,modo:button.dataset.review});
          output.innerHTML=`<p><strong>${result.vigente?'Revisión de la versión guardada':'La ficha cambió durante la revisión: vuelve a revisarla'}</strong></p><p class="small">Sin consulta automática a Nexus ni WhatsApp. Las recomendaciones no completan el checklist.</p><ul>${(result.hallazgos||[]).map(h=>`<li><strong>${esc(h.prioridad)} · ${esc(h.etapa)}</strong>: ${esc(h.evidencia)} ${esc(h.accion)}</li>`).join('')}</ul>${result.recomendacion?`<h4>Recomendaciones IA</h4><p class="ingreso-advice">${esc(result.recomendacion)}</p>`:''}${result.aviso?`<p role="alert">${esc(result.aviso)}</p>`:''}`;
        }catch(error){output.textContent=error.message||'No se pudo revisar la ficha.';}
        finally{reviewing=false;container.dataset.saving='false';form.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);}
      });
      form.oninput=()=>{dirty=true;container.dataset.dirty='true';container.querySelector('[data-review-result]').textContent='Hay cambios sin guardar: cualquier revisión anterior ya no representa el formulario.';};
      const leave=()=>!dirty || window.confirm('Hay cambios sin guardar. ¿Descartarlos?');
      container.querySelector('[data-back]').onclick=()=>{if(!saving&&leave())list();};
      container.querySelector('[data-reload]').onclick=()=>{if(!saving&&leave())mount(container,options);};
      form.onsubmit=async e=>{
        e.preventDefault(); if(saving)return;
        const f=new FormData(form), input=Object.fromEntries(f);
        input.checklist=Object.fromEntries(STEPS.map(([key])=>[key,{estado:f.get(key+'_estado'),responsable:f.get(key+'_responsable'),nota:f.get(key+'_nota')}]));
        const message=form.querySelector('[data-message]');
        try {
          const key=current?.key || newKey(input.nombre);
          if (!current && clients.some(x=>normalize(x.nombre)===normalize(input.nombre)||x.key===key)) throw new Error('Ese cliente ya existe. Abre su ficha desde la lista.');
          saving=true; container.dataset.saving='true'; form.querySelectorAll('button,input,textarea,select').forEach(b=>b.disabled=true);
          const row=await save(client,key,input,current?.row);
          rows=rows.filter(r=>r.key!==row.key).concat(row); clients=catalog(options.projects,rows); current=clients.find(x=>x.key===key);
          if (container.isConnected) options.onLoad?.(rows);
          dirty=false; container.dataset.dirty='false'; message.textContent='Ficha guardada.';
          container.querySelector('[data-review-result]').textContent='Ficha guardada. Puedes iniciar una nueva revisión.';
        } catch(error) { message.textContent=error.message; }
        finally {saving=false; container.dataset.saving='false'; form.querySelectorAll('button,input,textarea,select').forEach(b=>b.disabled=false);}
      };
    }
    const selected=clients.find(c=>c.key===options.selected);
    if(selected)edit(selected); else list();
  }
  return {PREFIX,STEPS,STATES,newKey,validate,progress,catalog,load,save,mount};
});
