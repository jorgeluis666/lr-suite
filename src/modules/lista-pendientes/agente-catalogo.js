// Catálogo único para el navegador y la Edge Function. Sin acceso a datos ni secretos.
(() => {
const herramientas = [
  {
    name: "iniciar_cronometro",
    description:
      "Arranca el cronómetro de un pendiente y lo deja «En proceso». Solo puede haber uno " +
      "corriendo: si ya hay otro andando, ese se pausa y su tiempo queda guardado. Úsala cuando " +
      "la persona acepta ponerse a trabajar en algo concreto.",
    input_schema: {
      type: "object",
      properties: { tarea_id: { type: "string", description: "id del pendiente, tal como viene en el tablero" } },
      required: ["tarea_id"],
    },
  },
  {
    name: "pausar_cronometro",
    description: "Pausa el cronómetro que está corriendo y guarda el tiempo acumulado.",
    input_schema: {
      type: "object",
      properties: { tarea_id: { type: "string", description: "id del pendiente con el cronómetro activo" } },
      required: ["tarea_id"],
    },
  },
  {
    name: "completar_tarea",
    description:
      "Cierra el pendiente y lo manda al historial de completadas con su tiempo. No lo borra: se " +
      "puede regresar desde el historial. Úsala solo cuando la persona confirma que ya terminó.",
    input_schema: {
      type: "object",
      properties: { tarea_id: { type: "string" } },
      required: ["tarea_id"],
    },
  },
  {
    name: "crear_pendiente",
    description: "Agrega un pendiente nuevo al tablero del mes en curso.",
    input_schema: {
      type: "object",
      properties: {
        titulo: { type: "string", description: "qué hay que hacer, en una línea" },
        responsable: { type: "string", description: "nombre tal como aparece en el tablero" },
        prioridad: { type: "string", enum: ["Alta", "Media", "Baja"] },
        inicio: { type: "string", description: "fecha AAAA-MM-DD" },
        fin: { type: "string", description: "fecha AAAA-MM-DD" },
      },
      required: ["titulo"],
    },
  },
  {
    name: "crear_tarea_interna",
    description:
      "Agrega una tarea interna (subtarea) dentro de un pendiente. Es la forma de partir algo " +
      "grande en pasos que se puedan ir tachando.",
    input_schema: {
      type: "object",
      properties: {
        tarea_id: { type: "string" },
        titulo: { type: "string" },
        responsable: { type: "string" },
        inicio: { type: "string", description: "fecha AAAA-MM-DD" },
        fin: { type: "string", description: "fecha AAAA-MM-DD" },
      },
      required: ["tarea_id", "titulo"],
    },
  },
  {
    name: "marcar_tarea_interna",
    description: "Marca una tarea interna como hecha, o la devuelve a pendiente.",
    input_schema: {
      type: "object",
      properties: {
        tarea_id: { type: "string" },
        tarea_interna_id: { type: "string", description: "id de la tarea interna dentro del pendiente" },
        hecha: { type: "boolean", description: "true para completarla, false para reabrirla" },
      },
      required: ["tarea_id", "tarea_interna_id", "hecha"],
    },
  },
  {
    name: "cambiar_campos",
    description:
      "Cambia estado, prioridad, responsable o fechas de un pendiente. Manda solo los campos que " +
      "hay que mover; lo demás queda igual. Cadena vacía en inicio o fin quita esa fecha.",
    input_schema: {
      type: "object",
      properties: {
        tarea_id: { type: "string" },
        estado: { type: "string", enum: ["Pendiente", "En proceso", "Bloqueado"] },
        prioridad: { type: "string", enum: ["Alta", "Media", "Baja"] },
        responsable: { type: "string" },
        inicio: { type: "string", description: "fecha AAAA-MM-DD" },
        fin: { type: "string", description: "fecha AAAA-MM-DD" },
      },
      required: ["tarea_id"],
    },
  },
  {
    name: "mover_pendiente",
    description:
      "Cambia el orden del tablero: deja un pendiente justo antes o justo después de otro. Es lo " +
      "mismo que arrastrarlo con el mouse, así que el que se mueve adopta el grupo del vecino al " +
      "que llega. Úsala cuando el tablero no esté en el orden en que conviene trabajarlo, por " +
      "ejemplo para subir un cliente en riesgo por encima de lo que no corre prisa.",
    input_schema: {
      type: "object",
      properties: {
        tarea_id: { type: "string", description: "el pendiente que se mueve" },
        referencia_id: { type: "string", description: "el pendiente junto al que va a quedar" },
        posicion: {
          type: "string",
          enum: ["antes", "despues"],
          description: "si queda antes o después de la referencia",
        },
      },
      required: ["tarea_id", "referencia_id", "posicion"],
    },
  },
  {
    name: "corregir_texto",
    description:
      "Reescribe el nombre de un pendiente o de una tarea interna: faltas de ortografía, nombres a " +
      "medias, o títulos que no dicen qué hay que hacer ni para quién. Cambia solo el texto: no " +
      "toca fechas, responsable ni estado. Respeta el nombre del cliente y no cambies el sentido " +
      "de la tarea; si no estás seguro de qué quiso decir, pregunta en vez de corregir.",
    input_schema: {
      type: "object",
      properties: {
        tarea_id: { type: "string" },
        tarea_interna_id: {
          type: "string",
          description: "solo si lo que se corrige es una tarea interna; vacío para el pendiente",
        },
        titulo: { type: "string", description: "el texto corregido, completo" },
      },
      required: ["tarea_id", "titulo"],
    },
  },
  {
    name: "entregar_tarea",
    description:
      "Manda una tarea a quien la va a ejecutar, fuera de este chat. Dos destinos: «chrome» abre la " +
      "plataforma donde hay que trabajar (Google Ads, Meta, Drive, LinkedIn…) en el navegador, para " +
      "que Claude in Chrome la ejecute ahí; «claude» abre Claude con el encargo listo, para lo que " +
      "es largo, necesita archivos o varias fuentes. En los dos casos el encargo queda copiado al " +
      "portapapeles. Úsala solo cuando la tarea no se pueda resolver aquí mismo con lo que ya " +
      "tienes; lo que puedas resolver tú, resuélvelo en el chat y no lo entregues a nadie.",
    input_schema: {
      type: "object",
      properties: {
        tarea_id: { type: "string", description: "el pendiente del que sale" },
        tarea_interna_id: { type: "string", description: "la tarea interna concreta, si la hay" },
        destino: { type: "string", enum: ["chrome", "claude"] },
        instruccion: {
          type: "string",
          description:
            "el encargo completo y autocontenido: qué hacer, en qué cuenta o marca, con qué cifras " +
            "del tablero y qué significa que esté terminado. Quien lo recibe no ve este tablero.",
        },
        url: {
          type: "string",
          description: "con destino «chrome», la dirección https de la plataforma donde se trabaja",
        },
      },
      required: ["tarea_id", "destino", "instruccion"],
    },
  },
  {
    name: "ver_agenda",
    description:
      "Consulta Google Calendar: qué hay ocupado y qué huecos quedan libres en horario de " +
      "trabajo. Es una consulta, se ejecuta sola y no agenda nada. Úsala SIEMPRE antes de " +
      "ofrecer un horario.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "fecha AAAA-MM-DD desde la que mirar (por omisión, hoy)" },
        dias: { type: "integer", description: "cuántos días mirar, de 1 a 14 (por omisión, 3)" },
        duracion_min: { type: "integer", description: "duración del hueco que buscas, en minutos" },
      },
      required: [],
    },
  },
  {
    name: "agendar_reunion",
    description:
      "Crea la reunión en Google Calendar con enlace de Meet, y le manda la invitación a los " +
      "invitados que lleve. Sirve también para bloquear un rato de trabajo sin interrupciones " +
      "(en ese caso, sin invitados). Usa una hora que ver_agenda haya dado por libre.",
    input_schema: {
      type: "object",
      properties: {
        titulo: { type: "string", description: "cómo se va a ver en el calendario" },
        inicio: { type: "string", description: "inicio exacto, uno de los huecos de ver_agenda (ISO)" },
        duracion_min: { type: "integer", description: "cuánto dura, en minutos" },
        invitados: {
          type: "array",
          items: { type: "string" },
          description: "correos de los invitados; vacío para un bloque personal",
        },
        detalle: { type: "string", description: "una o dos líneas de para qué es la reunión" },
        tarea_id: { type: "string", description: "el pendiente del que sale, si sale de uno" },
      },
      required: ["titulo", "inicio"],
    },
  },
];
  const texto = { type: "string" };
  const booleano = { type: "boolean" };
  const pagina = { type: "integer", minimum: 0 };
  const tarea = { tarea_id: texto };
  const interna = { ...tarea, tarea_interna_id: texto };
  const opcion = (...valores) => ({ type: "string", enum: valores });
  const fecha = { type: "string", description: "AAAA-MM-DD; cadena vacía para quitar la fecha" };
  const hora = { type: "string", description: "HH:MM de Lima; cadena vacía para quitar la hora" };
  const consultas = ["ver_agenda"];
  function agregar(name, description, properties = {}, required = [], consulta = false) {
    herramientas.push({ name, description, input_schema: { type: "object", properties, required, additionalProperties: false } });
    if (consulta) consultas.push(name);
  }
  agregar("consultar_funciones", "Lista todas tus funciones disponibles y sus parámetros. Consulta este catálogo antes de decir que una acción no existe.", {}, [], true);
  agregar("consultar_pendientes", "Busca pendientes de cualquier mes, vista o responsable, incluso fuera del contexto inicial. Devuelve 20 por página y siguiente; no inventes IDs.", { buscar: texto, mes: texto, vista: texto, responsable: texto, estado: opcion("Pendiente", "En proceso", "Bloqueado"), prioridad: opcion("Alta", "Media", "Baja"), desde: pagina }, [], true);
  agregar("consultar_pendiente", "Lee los datos completos de un pendiente y 20 tareas internas por página, con IDs de hitos, enlaces, seguimientos, fechas, horas y marcas. Usa siguiente para continuar.", { ...tarea, desde: pagina }, ["tarea_id"], true);
  agregar("consultar_historial", "Carga y busca el historial de terminados y eliminados; devuelve claves para restaurar, 20 por página.", { buscar: texto, desde: pagina }, [], true);
  agregar("consultar_organizacion", "Consulta responsables, vistas, listas, grupos, colores y destinos reales para compartir tareas.", {}, [], true);
  agregar("consultar_control", "Consulta cierres y tiempo por persona para una fecha y mes; por defecto hoy y mes actual.", { fecha, mes: texto }, [], true);
  agregar("eliminar_pendiente", "Elimina el pendiente completo con todas sus tareas internas. Se conserva en Terminados y puede restaurarse.", tarea, ["tarea_id"]);
  agregar("duplicar_pendiente", "Duplica un pendiente y sus tareas internas, en la misma vista, sin copiar su cronómetro.", tarea, ["tarea_id"]);
  agregar("restaurar_pendiente", "Restaura un registro de Terminados con sus tareas y tiempo; usa la clave de consultar_historial. Recibe un ID nuevo.", { historial_id: texto }, ["historial_id"]);
  agregar("ajustar_tiempo", "Corrige los segundos acumulados del cronómetro pausado. No modifica el registro diario de trabajo.", { ...tarea, segundos: { type: "integer", minimum: 0, maximum: 31536000 } }, ["tarea_id", "segundos"]);
  agregar("desbloquear_pendiente", "Pausa el cronómetro que bloquea un pendiente conservando el tiempo. Solo superadministradores; requiere confirmación.", tarea, ["tarea_id"]);
  agregar("eliminar_tarea_interna", "Borra una tarea interna o seguimiento y su copia compartida. Las diarias deben dejar de ser diarias primero. Devuelve clave para deshacer durante esta sesión.", interna, ["tarea_id", "tarea_interna_id"]);
  agregar("restaurar_tarea_interna", "Deshace una eliminación realizada por este agente en esta sesión; restaura con ID nuevo y sin compartir.", { eliminacion_id: texto }, ["eliminacion_id"]);
  agregar("cambiar_tarea_interna", "Edita responsable, fechas y horario de una tarea interna; solo cambia campos enviados. Cadena vacía elimina fecha u hora. Valida todo antes de guardar y sincroniza su pareja.", { ...interna, responsable: texto, inicio: fecha, fin: fecha, hora_inicio: hora, hora_fin: hora }, ["tarea_id", "tarea_interna_id"]);
  agregar("mover_tarea_interna", "Ordena una tarea interna antes o después de otra dentro del mismo pendiente; mueve sus seguimientos y respeta el anclaje de diarias.", { ...interna, referencia_id: texto, posicion: opcion("antes", "despues") }, ["tarea_id", "tarea_interna_id", "referencia_id", "posicion"]);
  agregar("configurar_tarea_diaria", "Activa o desactiva la recurrencia diaria. Las diarias se anclan y se reabren automáticamente cada día; un seguimiento no puede ser diario.", { ...interna, diaria: booleano }, ["tarea_id", "tarea_interna_id", "diaria"]);
  agregar("marcar_claude", "Enciende o apaga la marca de trabajo con Claude Code; no ejecuta trabajo fuera de la Suite.", { ...interna, activa: booleano }, ["tarea_id", "tarea_interna_id", "activa"]);
  agregar("compartir_tarea_interna", "Comparte una tarea con un destino de consultar_organizacion, o deja de compartirla. Usa el estado deseado; no cambia silenciosamente de destino si ya está compartida.", { ...interna, compartir: booleano, destino: texto }, ["tarea_id", "tarea_interna_id", "compartir"]);
  agregar("crear_seguimiento", "Agrega un punto de seguimiento a una tarea interna completada.", { ...interna, titulo: texto, responsable: texto }, ["tarea_id", "tarea_interna_id", "titulo"]);
  agregar("agregar_enlace", "Añade un enlace seguro y su etiqueta a una tarea interna.", { ...interna, url: texto, etiqueta: texto }, ["tarea_id", "tarea_interna_id", "url"]);
  agregar("eliminar_enlace", "Quita el enlace indicado de una tarea interna.", { ...interna, enlace_id: texto }, ["tarea_id", "tarea_interna_id", "enlace_id"]);
  agregar("agregar_hito", "Agrega un hito a la lista de una tarea interna.", { ...interna, titulo: texto }, ["tarea_id", "tarea_interna_id", "titulo"]);
  agregar("editar_hito", "Cambia el título de un hito sin cambiar si está hecho.", { ...interna, hito_id: texto, titulo: texto }, ["tarea_id", "tarea_interna_id", "hito_id", "titulo"]);
  agregar("marcar_hito", "Marca o desmarca un hito; guarda autor y fecha y sincroniza la tarea compartida.", { ...interna, hito_id: texto, hecho: booleano }, ["tarea_id", "tarea_interna_id", "hito_id", "hecho"]);
  agregar("eliminar_hito", "Borra un hito de la lista de una tarea interna.", { ...interna, hito_id: texto }, ["tarea_id", "tarea_interna_id", "hito_id"]);
  agregar("crear_lista", "Crea una pestaña de lista y le asigna los pendientes indicados. Una lista vacía es local hasta recibir su primer pendiente.", { titulo: texto, tareas_ids: { type: "array", items: texto, maxItems: 100 } }, ["titulo"]);
  agregar("eliminar_lista", "Elimina una lista; sus pendientes regresan a su vista fija sin borrarse. No elimina parcialmente listas con pendientes bloqueados.", { lista_id: texto }, ["lista_id"]);
  agregar("asignar_lista", "Manda un pendiente a una lista existente; lista_id vacío lo quita de la lista.", { ...tarea, lista_id: texto }, ["tarea_id", "lista_id"]);
  agregar("cambiar_vista", "Mueve un pendiente a Día a día, Proyectos o una lista existente. Respeta los tableros fijos.", { ...tarea, vista: texto }, ["tarea_id", "vista"]);
  agregar("cambiar_color", "Cambia el color del pendiente a uno de los colores de consultar_organizacion.", { ...tarea, color: texto }, ["tarea_id", "color"]);
  agregar("editar_grupo", "Edita título o etiqueta de responsables de un grupo manual o ruta sugerida de consultar_organizacion. La etiqueta no reasigna las tareas.", { grupo_id: texto, titulo: texto, responsables: texto }, ["grupo_id"]);
  agregar("filtrar_tablero", "Cambia los filtros visibles del módulo: mes, pestaña, responsable, estado y prioridad. No modifica los pendientes.", { mes: texto, vista: texto, responsable: texto, estado: opcion("Todos", "Pendiente", "En proceso", "Bloqueado", "Completado"), prioridad: opcion("Todas", "Alta", "Media", "Baja") });
  agregar("mostrar_detalle", "Abre o cierra las tareas internas o el panel de fechas, enlaces, hitos o seguimiento de una tarea.", { ...tarea, tarea_interna_id: texto, panel: opcion("tareas", "fechas", "enlaces", "hitos", "seguimiento"), abierto: booleano }, ["tarea_id", "panel", "abierto"]);
  agregar("abrir_historial", "Abre Terminados para revisar y restaurar pendientes.");
  agregar("exportar_historial", "Descarga en el navegador el CSV del historial cargado de terminados y eliminados.");
  agregar("sincronizar_tablero", "Solicita la sincronización manual del estado compartido; informa si falla.");

  for (const herramienta of herramientas) herramienta.input_schema.additionalProperties = false;
  function validar(nombre, entrada) {
    const herramienta = herramientas.find((item) => item.name === nombre);
    if (!herramienta) return "Esa herramienta no existe.";
    if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return "Los parámetros deben ser un objeto.";
    const esquema = herramienta.input_schema;
    for (const campo of esquema.required || []) {
      if (!(campo in entrada)) return `Falta el parámetro ${campo}.`;
    }
    for (const [campo, valor] of Object.entries(entrada)) {
      const regla = esquema.properties[campo];
      if (!regla) return `Parámetro desconocido: ${campo}.`;
      if (regla.type === "integer" ? !Number.isSafeInteger(valor) : regla.type === "array" ? !Array.isArray(valor) : typeof valor !== regla.type) return `Tipo inválido: ${campo}.`;
      if (regla.enum && !regla.enum.includes(valor)) return `Valor inválido: ${campo}.`;
      if (regla.minimum !== undefined && valor < regla.minimum || regla.maximum !== undefined && valor > regla.maximum) return `Fuera de rango: ${campo}.`;
      if (regla.type === "array" && (valor.length > (regla.maxItems || 100) || valor.some((item) => typeof item !== regla.items.type))) return `Lista inválida: ${campo}.`;
      if (typeof valor === "string" && valor.length > 8000) return `Texto demasiado largo: ${campo}.`;
      if ((campo.endsWith("_id") && campo !== "lista_id" || ["titulo", "url", "responsable", "grupo_id"].includes(campo)) && typeof valor === "string" && !valor.trim()) return `Campo vacío: ${campo}.`;
    }
    return "";
  }
  globalThis.LRPendientesCatalogo = { herramientas, consultas, validar };
})();
