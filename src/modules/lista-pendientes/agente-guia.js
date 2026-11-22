// Guía para las personas: los IDs vinculan cada explicación al catálogo ejecutable.
(() => {
  const grupos = [
    {
      titulo: "Consultar y entender el trabajo",
      ejemplo: "¿Qué pendientes tiene Diego este mes y cuáles están bloqueados?",
      funciones: [
        ["consultar_pendientes", "Buscar pendientes", "Encuentra tareas por nombre, mes, responsable, estado, prioridad o lista, aunque no estén a la vista."],
        ["consultar_pendiente", "Revisar una tarea a fondo", "Lee sus tareas internas, fechas, horarios, enlaces, hitos y seguimientos."],
        ["consultar_historial", "Consultar lo terminado o eliminado", "Busca pendientes en el historial para revisarlos o recuperarlos."],
        ["consultar_organizacion", "Conocer la organización del tablero", "Identifica responsables, listas, grupos y tableros donde compartir tareas."],
        ["consultar_control", "Consultar avances y tiempo trabajado", "Resume los pendientes cerrados, las tareas internas hechas y el tiempo por persona, día y mes."],
        ["consultar_funciones", "Explicar sus propias funciones", "Puedes preguntarle qué sabe hacer y cómo pedirle una acción."]
      ]
    },
    {
      titulo: "Gestionar pendientes",
      ejemplo: "Crea un pendiente para revisar la campaña de Royal Baby y asígnalo a Diego.",
      funciones: [
        ["crear_pendiente", "Crear un pendiente", "Añade una tarea con título, responsable, prioridad y fechas."],
        ["cambiar_campos", "Cambiar responsable, estado, prioridad o fechas", "Actualiza los datos que le indiques; también puede quitar fechas."],
        ["corregir_texto", "Renombrar y corregir textos", "Mejora el título de un pendiente o de una tarea interna."],
        ["mover_pendiente", "Ordenar pendientes", "Coloca un pendiente antes o después de otro y adopta su grupo."],
        ["duplicar_pendiente", "Duplicar un pendiente", "Copia el pendiente con sus tareas internas y comienza con el cronómetro en cero."],
        ["completar_tarea", "Dar un pendiente por terminado", "Lo envía al historial con sus tareas y el tiempo trabajado."],
        ["eliminar_pendiente", "Eliminar un pendiente completo", "Retira el pendiente y todas sus tareas internas. Se puede recuperar desde Terminados."],
        ["restaurar_pendiente", "Restaurar un pendiente", "Recupera del historial el pendiente con sus tareas y tiempo."]
      ]
    },
    {
      titulo: "Trabajar con tareas internas",
      ejemplo: "Divide la revisión de campaña en tres tareas internas y ponles fecha de fin.",
      funciones: [
        ["crear_tarea_interna", "Dividir el trabajo en pasos", "Crea tareas internas dentro de un pendiente, con responsable y fechas."],
        ["marcar_tarea_interna", "Marcar como hecha o reabrir", "Completa una tarea interna o la devuelve a pendiente."],
        ["cambiar_tarea_interna", "Editar responsable, fechas y horario", "Asigna quién la hace y cuándo; también puede quitar fechas u horas."],
        ["mover_tarea_interna", "Reordenar tareas internas", "Mueve una tarea junto con sus seguimientos, respetando las diarias ancladas."],
        ["configurar_tarea_diaria", "Activar o quitar la repetición diaria", "Ancla la tarea para que se reabra cada día, o la convierte en una tarea normal."],
        ["eliminar_tarea_interna", "Borrar una tarea interna", "Elimina la tarea y su copia compartida. Si es diaria, primero hay que quitar esa marca."],
        ["restaurar_tarea_interna", "Deshacer un borrado del agente", "Recupera una interna que el agente borró en esta sesión. Vuelve sin compartir con otro tablero."]
      ]
    },
    {
      titulo: "Hitos, enlaces y colaboración",
      ejemplo: "Agrega los hitos de revisar presupuesto, conversiones y palabras clave a esta tarea.",
      funciones: [
        ["agregar_hito", "Añadir puntos a una lista de comprobación", "Crea hitos dentro de una tarea interna."],
        ["editar_hito", "Editar un hito", "Cambia el texto de un punto de la lista."],
        ["marcar_hito", "Marcar o desmarcar un hito", "Registra qué punto está hecho, quién lo marcó y cuándo."],
        ["eliminar_hito", "Eliminar un hito", "Quita un punto de la lista sin borrar la tarea."],
        ["agregar_enlace", "Guardar un enlace", "Añade un enlace con nombre a una tarea interna."],
        ["eliminar_enlace", "Quitar un enlace", "Retira el enlace que ya no necesitas."],
        ["crear_seguimiento", "Dar seguimiento a una tarea terminada", "Añade un nuevo punto por hacer junto a una tarea interna que ya se completó."],
        ["compartir_tarea_interna", "Compartir entre tableros", "Muestra la misma tarea en Día a día o en una lista, o deja de compartirla. Su avance se mantiene sincronizado."],
        ["marcar_claude", "Marcar trabajo con Claude Code", "Enciende o apaga el robot que indica que usas Claude Code. La marca por sí sola no ejecuta la tarea."]
      ]
    },
    {
      titulo: "Organizar el tablero",
      ejemplo: "Crea la lista Cierre de mes y mueve allí los pendientes de reportes.",
      funciones: [
        ["crear_lista", "Crear una lista", "Abre una pestaña nueva y puede incluir los pendientes que elijas."],
        ["eliminar_lista", "Eliminar una lista", "Quita la pestaña y conserva sus pendientes."],
        ["asignar_lista", "Agregar o quitar un pendiente de una lista", "Cambia en qué lista se organiza el pendiente."],
        ["cambiar_vista", "Mover a otro tablero", "Envía un pendiente a Día a día, Proyectos o una lista, respetando los tableros fijos."],
        ["editar_grupo", "Editar la cabecera de un grupo", "Cambia el título o la etiqueta de responsables; no reasigna las tareas."],
        ["cambiar_color", "Cambiar el color de un pendiente", "Elige un color de la paleta del tablero."],
        ["filtrar_tablero", "Cambiar lo que ves", "Filtra la pantalla por mes, lista, responsable, estado o prioridad."]
      ]
    },
    {
      titulo: "Controlar el tiempo",
      ejemplo: "Inicia el cronómetro de la revisión de reportes.",
      funciones: [
        ["iniciar_cronometro", "Iniciar el cronómetro", "Comienza a contar tiempo en un pendiente y pausa el anterior que tenías activo."],
        ["pausar_cronometro", "Pausar el cronómetro", "Detiene el tramo de trabajo y guarda el tiempo acumulado."],
        ["ajustar_tiempo", "Corregir el tiempo acumulado", "Ajusta la duración cuando el cronómetro está pausado. El registro diario no cambia."],
        ["desbloquear_pendiente", "Destrabar un cronómetro", "Un superadministrador puede pausar el cronómetro que bloquea una tarea, conservando el tiempo de quien la trabajó."]
      ]
    },
    {
      titulo: "Ver detalles, historial y sincronización",
      ejemplo: "Abre las fechas de esta tarea y descarga el historial de terminados.",
      funciones: [
        ["mostrar_detalle", "Abrir o cerrar detalles", "Muestra las tareas internas o sus paneles de fechas, enlaces, hitos y seguimiento."],
        ["abrir_historial", "Abrir Terminados", "Abre el panel para revisar pendientes cerrados o eliminados."],
        ["exportar_historial", "Descargar el historial", "Descarga un archivo CSV con el historial disponible."],
        ["sincronizar_tablero", "Sincronizar los cambios", "Solicita la actualización compartida del tablero e informa si pudo confirmarla."]
      ]
    },
    {
      titulo: "Agenda y encargos externos",
      ejemplo: "Busca un hueco libre de 30 minutos para revisar la campaña mañana.",
      funciones: [
        ["ver_agenda", "Consultar horarios libres", "Consulta Google Calendar antes de ofrecerte una hora. Requiere que la agenda esté conectada."],
        ["agendar_reunion", "Agendar una reunión o bloque de trabajo", "Crea el evento en Google Calendar y, si corresponde, envía invitaciones con Meet."],
        ["entregar_tarea", "Preparar un encargo para otra herramienta", "Abre Claude o una plataforma y copia las instrucciones. La entrega no significa que el trabajo externo ya esté hecho."]
      ]
    }
  ];
  const escapar = (valor) => String(valor).replace(/[&<>"']/g, (letra) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[letra]);
  const normalizar = (valor) => String(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  function html(catalogo) {
    const disponibles = new Set(catalogo.herramientas.map((funcion) => funcion.name));
    const visibles = grupos.map((grupo) => ({ ...grupo, funciones: grupo.funciones.filter(([id]) => disponibles.has(id)) })).filter((grupo) => grupo.funciones.length);
    const total = visibles.reduce((suma, grupo) => suma + grupo.funciones.length, 0);
    return `<section class="agente-guia" aria-label="Funciones del Agente IA de Pendientes">
      <div class="notif-head"><div><strong>¿Qué puede hacer el Agente IA?</strong><p>${total} funciones para trabajar en Pendientes. Pídeselas en el chat con tus propias palabras.</p></div></div>
      <p class="agente-guia-aviso">Las consultas se resuelven al momento. Para cambiar algo, el agente te muestra la acción y tú eliges <strong>Hazlo</strong> o <strong>Ahora no</strong>. Se respetan tus permisos y los bloqueos del tablero.</p>
      <label class="agente-guia-buscar">Buscar una función<input type="search" data-agente-guia-buscar placeholder="Por ejemplo: eliminar, fechas, listas…" autocomplete="off" /></label>
      <p class="agente-guia-cuenta" data-agente-guia-cuenta role="status" aria-live="polite">${total} funciones en ${visibles.length} categorías</p>
      <div class="agente-guia-lista">
        ${visibles.map((grupo, indice) => `<details class="agente-guia-grupo" data-agente-guia-grupo ${indice === 0 ? "open" : ""}>
          <summary>${escapar(grupo.titulo)} <span>${grupo.funciones.length}</span></summary>
          <p class="agente-guia-ejemplo">Puedes pedirle: <q>${escapar(grupo.ejemplo)}</q></p>
          <ul>${grupo.funciones.map(([id, titulo, descripcion]) => `<li data-agente-guia-funcion data-busqueda="${escapar(normalizar(`${grupo.titulo} ${titulo} ${descripcion} ${id.replaceAll("_", " ")}`))}"><strong>${escapar(titulo)}</strong><p>${escapar(descripcion)}</p></li>`).join("")}</ul>
        </details>`).join("")}
        <p class="agente-guia-vacio" data-agente-guia-vacio hidden>No encontramos esa función. Prueba con otra palabra, como «tarea» o «fecha».</p>
      </div>
      <p class="notif-foot">Este mapa corresponde al agente de Pendientes. Abre su chat para pedirle una acción.</p>
    </section>`;
  }

  function conectar(raiz) {
    const campo = raiz.querySelector("[data-agente-guia-buscar]");
    if (!campo) return;
    campo.addEventListener("input", () => {
      const busqueda = normalizar(campo.value.trim());
      let total = 0;
      raiz.querySelectorAll("[data-agente-guia-grupo]").forEach((grupo, indice) => {
        let encontrados = 0;
        grupo.querySelectorAll("[data-agente-guia-funcion]").forEach((funcion) => {
          funcion.hidden = !funcion.dataset.busqueda.includes(busqueda);
          if (!funcion.hidden) encontrados += 1;
        });
        grupo.hidden = encontrados === 0;
        grupo.open = busqueda ? encontrados > 0 : indice === 0;
        total += encontrados;
      });
      raiz.querySelector("[data-agente-guia-cuenta]").textContent = `${total} ${total === 1 ? "función disponible" : "funciones disponibles"}`;
      raiz.querySelector("[data-agente-guia-vacio]").hidden = total > 0;
    });
  }
  globalThis.LRPendientesGuia = { html, conectar, grupos };
})();
