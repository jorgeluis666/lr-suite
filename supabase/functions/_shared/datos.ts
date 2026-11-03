// Lectura y escritura de lo que el asistente necesita saber y recordar.
import { db, lista } from "./base.ts";

export type TipoReunion = {
  id: string;
  nombre: string;
  duracion_min: number;
  modalidad?: string;
  descripcion?: string;
  requisitos?: string[];
};

export type Config = {
  zona_horaria: string;
  horario: Record<string, [string, string][]>;
  tipos: TipoReunion[];
  duracion_default_min: number;
  granularidad_min: number;
  anticipacion_min: number;
  tope_dia: number;
  feriados: string[];
  calendar_id: string | null;
  bot_activo: boolean;
  modelo_conversacion?: string;
  modelo_validacion?: string;
};

export type Estandares = {
  tono: string;
  idioma: string;
  largo_max: number;
  siempre: string[];
  nunca: string[];
  limites: Record<string, unknown>;
  derivar_si: string[];
  requisitos_cita: string[];
  respuesta_segura: string;
};

export type Conocimiento = {
  tipo: string;
  titulo: string;
  contenido: string;
};

export type Conversacion = {
  wa_id: string;
  nombre: string | null;
  estado: "bot" | "humano";
  etapa: string;
  resumen: string;
  atencion: string | null;
};

export type Mensaje = { rol: "cliente" | "asistente" | "equipo"; texto: string };

export async function leerConfig(): Promise<Config> {
  const { data, error } = await db()
    .from("lr_suite_agenda_config")
    .select("*")
    .eq("app_id", "lr-suite-agenda")
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la configuración: ${error.message}`);

  const fila = data ?? {};
  return {
    zona_horaria: fila.zona_horaria || "America/Lima",
    horario: (fila.horario ?? {}) as Config["horario"],
    tipos: Array.isArray(fila.tipos) ? (fila.tipos as TipoReunion[]) : [],
    duracion_default_min: Number(fila.duracion_default_min ?? 30),
    granularidad_min: Number(fila.granularidad_min ?? 30),
    anticipacion_min: Number(fila.anticipacion_min ?? 120),
    tope_dia: Number(fila.tope_dia ?? 4),
    feriados: lista(fila.feriados),
    calendar_id: fila.calendar_id || Deno.env.get("GOOGLE_CALENDAR_ID") || null,
    bot_activo: fila.bot_activo !== false,
    // El panel puede cambiar de modelo sin desplegar: Haiku para conversar, Sonnet si hace
    // falta más criterio. Si la fila no trae nada, mandan estos.
    modelo_conversacion: fila.modelo_conversacion || "claude-haiku-5-5",
    modelo_validacion: fila.modelo_validacion || "claude-haiku-5-5",
  };
}

export async function leerEstandares(): Promise<Estandares> {
  const { data, error } = await db()
    .from("lr_suite_agenda_estandares")
    .select("*")
    .eq("app_id", "lr-suite-agenda")
    .maybeSingle();
  if (error) throw new Error(`No se pudieron leer los estándares: ${error.message}`);

  const fila = data ?? {};
  return {
    tono: fila.tono || "",
    idioma: fila.idioma || "es-PE",
    largo_max: Number(fila.largo_max ?? 700),
    siempre: lista(fila.siempre),
    nunca: lista(fila.nunca),
    limites: (fila.limites ?? {}) as Record<string, unknown>,
    derivar_si: lista(fila.derivar_si),
    requisitos_cita: lista(fila.requisitos_cita),
    respuesta_segura: fila.respuesta_segura || "Lo reviso con el equipo y te confirmo en un momento.",
  };
}

export async function leerConocimiento(): Promise<Conocimiento[]> {
  const { data, error } = await db()
    .from("lr_suite_agenda_conocimiento")
    .select("tipo, titulo, contenido")
    .eq("activo", true)
    .order("tipo", { ascending: true })
    .order("orden", { ascending: true });
  if (error) throw new Error(`No se pudo leer el conocimiento: ${error.message}`);
  return (data ?? []) as Conocimiento[];
}

// Crea la conversación la primera vez que escribe un número.
export async function abrirConversacion(waId: string, nombre: string | null): Promise<Conversacion> {
  const { data, error } = await db()
    .from("lr_suite_agenda_conversaciones")
    .upsert(
      { wa_id: waId, ...(nombre ? { nombre } : {}), ultimo_mensaje_at: new Date().toISOString() },
      { onConflict: "wa_id", ignoreDuplicates: false },
    )
    .select("*")
    .single();
  if (error) throw new Error(`No se pudo abrir la conversación: ${error.message}`);
  return data as Conversacion;
}

// Idempotencia: si el wa_message_id ya estaba, Meta está reintentando el mismo webhook.
export async function guardarMensajeCliente(
  waId: string,
  texto: string,
  waMessageId: string,
): Promise<boolean> {
  const { error } = await db().from("lr_suite_agenda_mensajes").insert({
    wa_id: waId,
    rol: "cliente",
    texto,
    wa_message_id: waMessageId,
  });
  if (!error) return true;
  if (error.code === "23505") return false; // unique_violation: ya lo habíamos contestado
  throw new Error(`No se pudo guardar el mensaje: ${error.message}`);
}

export async function guardarMensajePropio(
  waId: string,
  texto: string,
  rol: "asistente" | "equipo",
  waMessageId: string | null = null,
  enviadoPor: string | null = null,
) {
  await db().from("lr_suite_agenda_mensajes").insert({
    wa_id: waId,
    rol,
    texto,
    wa_message_id: waMessageId,
    enviado_por: enviadoPor,
  });
  await db()
    .from("lr_suite_agenda_conversaciones")
    .update({ ultimo_mensaje_at: new Date().toISOString() })
    .eq("wa_id", waId);
}

export async function historial(waId: string, limite = 20): Promise<Mensaje[]> {
  const { data, error } = await db()
    .from("lr_suite_agenda_mensajes")
    .select("rol, texto")
    .eq("wa_id", waId)
    .order("creado_at", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`);
  return ((data ?? []) as Mensaje[]).reverse();
}

export async function marcarConversacion(
  waId: string,
  cambios: Partial<Pick<Conversacion, "etapa" | "resumen" | "atencion" | "estado" | "nombre">>,
) {
  await db().from("lr_suite_agenda_conversaciones").update(cambios).eq("wa_id", waId);
}

export async function anotarRevision(
  waId: string,
  borrador: string,
  enviado: string,
  veredicto: "aprobado" | "corregido" | "frenado",
  observaciones: string[],
  intentos: number,
  modelo: string,
) {
  await db().from("lr_suite_agenda_revisiones").insert({
    wa_id: waId,
    borrador,
    enviado,
    veredicto,
    observaciones,
    intentos,
    modelo,
  });
}
