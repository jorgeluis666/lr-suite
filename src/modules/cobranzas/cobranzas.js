(function (root) {
  'use strict';
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fecha = (valor) => new Date(valor).toLocaleString('es-PE', {timeZone:'America/Lima'});
  // Los estados del envío se pintan con el .badge de la suite: verde lo aceptado, rosa lo que
  // hay que revisar y gris lo que todavía no tiene resultado.
  const ESTADO_ENVIO = {
    preparado: ['', 'Intento sin confirmación'],
    aceptado_smtp: ['green', 'Aceptado por SMTP (entrega final no confirmada)'],
    rechazado: ['rose', 'Rechazo SMTP · revisar causa'],
    error: ['rose', 'Error de envío · resultado no confirmado'],
    cancelado: ['amber', 'Cancelado antes del envío'],
  };
  function mount(container, client) {
    container.innerHTML = `
      <section class="module cobranzas-module">
        <header class="header-card">
          <div>
            <h1>Cobranzas</h1>
            <p class="lead">Recordatorio diario a las 07:00 a. m. (Lima) para los contactos con pago pendiente. Al marcar el pago como completado se detienen los próximos envíos.</p>
          </div>
        </header>
        <details class="panel cobranzas-plantilla">
          <summary>
            <span>
              <strong>Mensaje del recordatorio</strong>
              <span class="small">Se envía desde cobros@limaretail.com. El mismo texto para todos los contactos.</span>
            </span>
            <span class="cobranzas-plantilla-abrir">Ver y editar</span>
          </summary>
          <form class="cobranzas-plantilla-form" data-plantilla>
            <label><span>Asunto</span><input name="asunto" required maxlength="200"></label>
            <label><span>Texto del correo</span><textarea name="cuerpo" required maxlength="5000" rows="14" spellcheck="true"></textarea></label>
            <p class="small">Una línea en blanco separa párrafos; los saltos sueltos se respetan, como en la firma. Lo que va entre **dos asteriscos** sale en negrita, y una dirección www queda enlazada.</p>
            <div class="cobranzas-plantilla-pie">
              <button class="btn primary" type="submit">Guardar mensaje</button>
              <span class="small" data-plantilla-estado role="status" aria-live="polite"></span>
            </div>
          </form>
        </details>
        <section class="panel">
          <div class="panel-head"><strong>Registrar contacto con saldo pendiente</strong></div>
          <form class="cobranzas-form">
            <label><span>Nombre de la persona</span><input name="nombre" required maxlength="200" autocomplete="name"></label>
            <label><span>Correo electrónico</span><input name="email" type="email" required maxlength="254" autocomplete="email"></label>
            <label><span>Nombre de la empresa</span><input name="empresa" required maxlength="200" autocomplete="organization"></label>
            <div class="cobranzas-form-actions"><button class="btn primary" type="submit">Registrar contacto</button></div>
          </form>
        </section>
        <section class="panel">
          <div class="toolbar">
            <div>
              <strong>Seguimiento de cobro</strong>
              <p class="small">La apertura es una señal aproximada. Sin señal no significa que el correo no fue leído o que fue bloqueado. Un rechazo de entrega pausa el seguimiento para revisión.</p>
            </div>
            <button class="btn" type="button" data-refresh>Actualizar</button>
          </div>
          <p class="cobranzas-message" data-message role="status" aria-live="polite"></p>
          <div data-list><p class="empty">Cargando contactos…</p></div>
        </section>
      </section>`;
    const form = container.querySelector('.cobranzas-form');
    const list = container.querySelector('[data-list]');
    const message = container.querySelector('[data-message]');
    const refresh = container.querySelector('[data-refresh]');
    const plantilla = container.querySelector('[data-plantilla]');
    const plantillaEstado = container.querySelector('[data-plantilla-estado]');
    let busy = false;
    // Sin tabla del mensaje no hay nada que guardar; operation() rehabilita todos los botones al
    // terminar, así que el estado del editor se recuerda aquí y no en la propiedad del botón.
    let plantillaDisponible = true;
    const aviso = (texto, clase = '') => {
      message.className = `cobranzas-message${clase ? ` ${clase}` : ''}`;
      message.textContent = texto;
    };
    const fail = error => {
      aviso(error.code === '23505' ? 'Este correo ya está registrado para esa empresa.'
        : ['42P01','PGRST205'].includes(error.code) ? 'El módulo aún necesita la instalación de su base de datos.'
        : `No se pudo completar la operación: ${error.message || 'intenta nuevamente.'}`, 'error');
    };
    // El mensaje se carga aparte de la lista: si la tabla todavía no está instalada, el resto
    // del módulo sigue funcionando y el aviso queda dentro de su propio panel.
    async function cargarPlantilla() {
      const {data, error} = await client.from('lr_suite_cobranzas_mensaje')
        .select('asunto,cuerpo,actualizado_en').limit(1);
      if (error) {
        plantillaDisponible = false;
        plantilla.querySelectorAll('input,textarea,button').forEach(e => e.disabled = true);
        plantillaEstado.textContent = ['42P01','PGRST205'].includes(error.code)
          ? 'El mensaje editable aún necesita la instalación de su base de datos.'
          : `No se pudo cargar el mensaje: ${error.message || 'intenta nuevamente.'}`;
        return;
      }
      const fila = data?.[0];
      if (!fila) { plantillaEstado.textContent = 'No hay un mensaje guardado todavía.'; return; }
      plantilla.elements.asunto.value = fila.asunto;
      plantilla.elements.cuerpo.value = fila.cuerpo;
      plantillaEstado.textContent = fila.actualizado_en ? `Actualizado ${fecha(fila.actualizado_en)}` : '';
    }
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
      list.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Persona</th><th>Correo</th><th>Empresa</th><th>Estado de pago</th><th>Último envío</th><th>Acción</th></tr></thead><tbody>${rows.map(row => `<tr>
        <td>${escape(row.nombre)}</td><td>${escape(row.email)}</td><td>${escape(row.empresa)}</td>
        <td>${row.estado === 'completado' ? '<span class="badge green">Completado · envíos detenidos</span>'
          : row.seguimiento_pausado ? '<span class="badge amber">Pendiente · envíos pausados</span>'
          : '<span class="badge">Pendiente</span>'}</td>
        <td>${row.ultimo_envio ? escape(fecha(row.ultimo_envio)) : '<span class="muted">Sin envío confirmado</span>'}${row.ultimo_intento && (!row.ultimo_envio || new Intl.DateTimeFormat('en-CA', {timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.ultimo_envio)) < row.ultimo_intento) ? `<span class="small">Intento del ${escape(row.ultimo_intento)} sin confirmación</span>` : ''}</td>
        <td><div class="cobranzas-actions"><button class="btn" type="button" data-history="${escape(row.id)}">Ver seguimiento</button>${row.estado === 'pendiente' ? `<button class="btn" type="button" data-pause="${escape(row.id)}" data-paused="${row.seguimiento_pausado ? 'true' : 'false'}">${row.seguimiento_pausado ? 'Reanudar tras revisión' : 'Pausar envíos'}</button><button class="btn" type="button" data-complete="${escape(row.id)}">Marcar pago completado</button>` : ''}</div></td>
      </tr>`).join('')}</tbody></table></div>` : '<p class="empty">No hay contactos registrados.</p>';
    }
    async function operation(fn) {
      if (busy) return;
      busy = true;
      container.querySelectorAll('button').forEach(b => b.disabled = true);
      aviso('');
      try { await fn(); } catch (error) { fail(error); }
      finally {
        busy = false;
        container.querySelectorAll('button').forEach(b => b.disabled = !plantillaDisponible && plantilla.contains(b));
      }
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
        await load();
        aviso('Contacto registrado con pago pendiente.');
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
          panel.innerHTML = `<div class="panel-head"><strong>Seguimiento · ${escape(history.closest('tr').children[0].textContent)}</strong></div>
            <p class="small cobranzas-note">Últimos 30 intentos. Un bloqueo personal o un rebote posterior no se puede deducir de SMTP.</p>
            ${data.length ? data.map(e => {
              const [tono, texto] = ESTADO_ENVIO[e.estado] || ['', e.estado];
              return `<div class="cobranzas-history-item">
                <strong>${escape(fecha(e.creado_en))}</strong>
                <span class="badge${tono ? ` ${tono}` : ''}">${escape(texto)}${e.codigo_smtp ? ` (${escape(e.codigo_smtp)})` : ''}</span>
                <p class="small">${escape(e.remitente)} · ${e.primera_apertura ? `señal de apertura ${escape(fecha(e.primera_apertura))} (puede ser automática)` : e.seguimiento_apertura ? 'sin señal de apertura' : 'apertura no medible: seguimiento no activado'}</p>
              </div>`;
            }).join('') : '<p class="empty">Aún no hay intentos registrados.</p>'}`;
          container.querySelector('.cobranzas-module').append(panel);
          panel.scrollIntoView?.({block:'nearest', behavior:'smooth'});
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
          aviso(paused ? 'Envíos pausados.' : 'Seguimiento reanudado para la próxima ejecución elegible.');
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
        await load();
        aviso('Pago completado. Los próximos recordatorios quedan detenidos.');
      });
    });
    // El guardado responde dentro de su propio panel: el aviso de la lista queda lejos de aquí.
    plantilla.addEventListener('submit', event => {
      event.preventDefault();
      operation(async () => {
        if (!plantillaDisponible) return;
        plantillaEstado.textContent = '';
        try {
          const asunto = plantilla.elements.asunto.value.trim();
          // Saltos \n siempre: así el texto plano y el HTML salen iguales desde cualquier equipo.
          const cuerpo = plantilla.elements.cuerpo.value.replace(/\r\n/g, '\n').trim();
          if (!asunto || !cuerpo) throw new Error('el asunto y el texto no pueden quedar vacíos.');
          const {data, error} = await client.from('lr_suite_cobranzas_mensaje')
            .update({asunto, cuerpo}).eq('id', 1).select('actualizado_en');
          if (error) throw error;
          if (!data?.length) throw new Error('la base no confirmó el cambio.');
          plantillaEstado.textContent = `Guardado${data[0].actualizado_en ? ` ${fecha(data[0].actualizado_en)}` : ''} · Los próximos recordatorios saldrán con este texto.`;
        } catch (error) {
          plantillaEstado.textContent = ['42501','PGRST301'].includes(error.code)
            ? 'No tienes permiso para cambiar el mensaje.'
            : `No se pudo guardar: ${error.message || 'intenta nuevamente.'}`;
        }
      });
    });
    refresh.addEventListener('click', () => operation(load));
    if (!client) { list.textContent = ''; fail(new Error('No hay conexión con Supabase.')); return; }
    operation(async () => {
      try { await load(); } catch (e) { list.innerHTML = '<p class="empty">No se pudo cargar la lista.</p>'; throw e; }
      await cargarPlantilla();
    });
  }
  root.LRCobranzas = {mount};
})(window);
