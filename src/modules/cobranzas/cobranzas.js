(function (root) {
  'use strict';
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function mount(container, client) {
    container.innerHTML = `
      <section class="module cobranzas-module">
        <div class="panel"><h1>Módulo de Cobranzas / Seguimiento de Cobro</h1>
          <p>Recordatorio diario a las 07:00 a. m. (Lima) para contactos con pago pendiente.</p>
          <p>Al marcar el pago como completado se detienen los próximos envíos.</p>
          <p>La apertura es una señal aproximada. Sin señal no significa que el correo no fue leído o que fue bloqueado. Un rechazo de entrega pausa el seguimiento para revisión.</p>
        </div>
        <div class="panel"><h2>Registrar contacto con saldo pendiente</h2>
          <form class="cobranzas-form">
            <label>Nombre de la persona<input name="nombre" required maxlength="200" autocomplete="name"></label>
            <label>Correo electrónico<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
            <label>Nombre de la empresa<input name="empresa" required maxlength="200" autocomplete="organization"></label>
            <button class="btn primary" type="submit">Registrar contacto</button>
          </form>
        </div>
        <div class="panel"><div class="toolbar"><h2>Seguimiento de cobro</h2><button class="btn" data-refresh>Actualizar</button></div>
          <p data-message role="status" aria-live="polite"></p><div data-list>Cargando contactos…</div>
        </div>
      </section>`;
    const form = container.querySelector('form');
    const list = container.querySelector('[data-list]');
    const message = container.querySelector('[data-message]');
    const refresh = container.querySelector('[data-refresh]');
    let busy = false;
    const fail = error => {
      message.textContent = error.code === '23505' ? 'Este correo ya está registrado para esa empresa.'
        : ['42P01','PGRST205'].includes(error.code) ? 'El módulo aún necesita la instalación de su base de datos.'
        : `No se pudo completar la operación: ${error.message || 'intenta nuevamente.'}`;
    };
    async function load() {
      // Paginar para no esconder contactos cuando se supera el límite de PostgREST.
      const rows = [];
      for (let start = 0; ; start += 500) {
        const {data, error} = await client.from('lr_suite_cobranzas')
          .select('id,nombre,email,empresa,estado,seguimiento_pausado,ultimo_intento,ultimo_envio').order('id').range(start, start + 499);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 500) break;
      }
      if (!container.isConnected) return;
      list.innerHTML = rows.length ? `<div class="cobranzas-table"><table><thead><tr><th>Persona</th><th>Correo</th><th>Empresa</th><th>Estado de pago</th><th>Último envío</th><th>Acción</th></tr></thead><tbody>${rows.map(row => `<tr>
        <td>${escape(row.nombre)}</td><td>${escape(row.email)}</td><td>${escape(row.empresa)}</td>
        <td>${row.estado === 'completado' ? 'Completado · envíos detenidos' : row.seguimiento_pausado ? 'Pendiente · envíos pausados' : 'Pendiente'}</td>
        <td>${row.ultimo_envio ? escape(new Date(row.ultimo_envio).toLocaleString('es-PE', {timeZone:'America/Lima'})) : 'Sin envío confirmado'}${row.ultimo_intento && (!row.ultimo_envio || new Intl.DateTimeFormat('en-CA', {timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.ultimo_envio)) < row.ultimo_intento) ? `<br><small>Intento del ${escape(row.ultimo_intento)} sin confirmación</small>` : ''}</td>
        <td><button class="btn" data-history="${escape(row.id)}">Ver seguimiento</button>${row.estado === 'pendiente' ? `<button class="btn" data-pause="${escape(row.id)}" data-paused="${row.seguimiento_pausado ? 'true' : 'false'}">${row.seguimiento_pausado ? 'Reanudar tras revisión' : 'Pausar envíos'}</button><button class="btn" data-complete="${escape(row.id)}">Marcar pago completado</button>` : '—'}</td>
      </tr>`).join('')}</tbody></table></div>` : '<p>No hay contactos registrados.</p>';
    }
    async function operation(fn) {
      if (busy) return;
      busy = true;
      container.querySelectorAll('button').forEach(b => b.disabled = true);
      message.textContent = '';
      try { await fn(); } catch (error) { fail(error); }
      finally { busy = false; container.querySelectorAll('button').forEach(b => b.disabled = false); }
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      operation(async () => {
        const fields = new FormData(form);
        const contact = Object.fromEntries(['nombre','email','empresa'].map(k => [k, String(fields.get(k)).trim()]));
        if (Object.values(contact).some(v => !v)) throw new Error('Completa los tres campos.');
        const {error} = await client.from('lr_suite_cobranzas').insert(contact);
        if (error) throw error;
        form.reset();
        message.textContent = 'Contacto registrado con pago pendiente.';
        await load();
      });
    });
    list.addEventListener('click', event => {
      const history = event.target.closest('[data-history]');
      if (history) {
        operation(async () => {
          const {data, error} = await client.from('lr_suite_cobranzas_envios')
            .select('creado_en,remitente,estado,codigo_smtp,seguimiento_apertura,primera_apertura')
            .eq('contacto_id', history.dataset.history).order('creado_en', {ascending:false}).limit(30);
          if (error) throw error;
          container.querySelector('[data-history-panel]')?.remove();
          const panel = document.createElement('section');
          panel.className = 'panel'; panel.dataset.historyPanel = '';
          const status = {preparado:'Intento sin confirmación',aceptado_smtp:'Aceptado por SMTP (entrega final no confirmada)',rechazado:'Rechazo SMTP · revisar causa',error:'Error de envío · resultado no confirmado',cancelado:'Cancelado antes del envío'};
          panel.innerHTML = `<h2>Seguimiento · ${escape(history.closest('tr').children[0].textContent)}</h2><p>Últimos 30 intentos. Un bloqueo personal o un rebote posterior no se puede deducir de SMTP.</p>${data.length ? data.map(e => `<p>${escape(new Date(e.creado_en).toLocaleString('es-PE', {timeZone:'America/Lima'}))} · ${escape(e.remitente)}<br>${escape(status[e.estado] || e.estado)}${e.codigo_smtp ? ` (${escape(e.codigo_smtp)})` : ''}<br>${e.primera_apertura ? `Señal de apertura: ${escape(new Date(e.primera_apertura).toLocaleString('es-PE', {timeZone:'America/Lima'}))} (puede ser automática)` : e.seguimiento_apertura ? 'Sin señal de apertura' : 'Apertura no medible: seguimiento no activado'}</p>`).join('') : '<p>Aún no hay intentos registrados.</p>'}`;
          container.querySelector('.cobranzas-module').append(panel);
        });
        return;
      }
      const pause = event.target.closest('[data-pause]');
      if (pause) {
        operation(async () => {
          const paused = pause.dataset.paused !== 'true';
          const {data, error} = await client.from('lr_suite_cobranzas').update({seguimiento_pausado:paused})
            .eq('id', pause.dataset.pause).select('id');
          if (error) throw error;
          if (!data?.length) throw new Error('No se pudo actualizar el contacto.');
          await load();
          message.textContent = paused ? 'Envíos pausados.' : 'Seguimiento reanudado para la próxima ejecución elegible.';
        });
        return;
      }
      const button = event.target.closest('[data-complete]');
      if (!button) return;
      operation(async () => {
        const {data, error} = await client.from('lr_suite_cobranzas').update({estado:'completado'})
          .eq('id', button.dataset.complete).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No se pudo actualizar el contacto. Actualiza la lista.');
        message.textContent = 'Pago completado. Los próximos recordatorios quedan detenidos.';
        await load();
      });
    });
    refresh.addEventListener('click', () => operation(load));
    if (!client) { list.textContent = ''; fail(new Error('No hay conexión con Supabase.')); return; }
    operation(async () => { try { await load(); } catch (e) { list.textContent = 'No se pudo cargar la lista.'; throw e; } });
  }
  root.LRCobranzas = {mount};
})(window);
