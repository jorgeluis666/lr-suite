// Lo que el módulo «Agenda» del index.html necesita del servidor: enviar mensajes por WhatsApp,
// tocar Google Calendar y probar los estándares sin enviar nada.
//
// Despliegue: supabase functions deploy agenda-panel
// (aquí sí se exige JWT: solo Jorge Luis y Diego, comprobado contra las políticas RLS).
import { anotar, db, json, secreto } from "../_shared/base.ts";
import { createClient } from "@supabase/supabase-js";
import { enviarTexto } from "../_shared/whatsapp.ts";
import {
  guardarMensajePropio,
  historial,
  leerConfig,
  leerConocimiento,
  leerEstandares,
  marcarConversacion,
} from "../_shared/datos.ts";
import { borrarEvento, crearEvento, moverEvento, ocupado, pisa } from "../_shared/google.ts";
import { redactar, reglasDuras, revisar, type Contexto } from "../_shared/asistente.ts";

const cors = () => ({
  "access-control-allow-origin": Deno.env.get("PANEL_ORIGEN") || "*",
  "access-control-allow-headers": "authorization, content-type, apikey",
  "access-control-allow-methods": "POST, OPTIONS",
});

function respuesta(data: unknown, status = 200) {
  const salida = json(data, status);
  for (const [clave, valor] of Object.entries(cors())) salida.headers.set(clave, valor);
  return salida;
}

// La autorización no se repite aquí: se pregunta a la base. Si las políticas RLS dejan leer la
// configuración de la agenda, es uno de los dos usuarios de la Suite.
async function quien(peticion: Request): Promise<string | null> {
  const autorizacion = peticion.headers.get("authorization") ?? "";
  if (!autorizacion.toLowerCase().startsWith("bearer ")) return null;

  const cliente = createClient(secreto("SUPABASE_URL"), secreto("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: autorizacion } },
  });

  const { data: sesion } = await cliente.auth.getUser();
  const correo = sesion?.user?.email ?? "";
  if (!correo) return null;

  const { data, error } = await cliente
    .from("lr_suite_agenda_config")
    .select("app_id")
    .eq("app_id", "lr-suite-agenda")
    .maybeSingle();
  if (error || !data) return null;
  return correo;
}

async function contexto(waId: string, nombre: string | null = null): Promise<Contexto> {
  const [config, estandares, conocimiento] = await Promise.all([
    leerConfig(),
    leerEstandares(),
    leerConocimiento(),
  ]);
  return {
    conversacion: {
      wa_id: waId,
      nombre,
      estado: "bot",
      etapa: "nuevo",
      resumen: "",
      atencion: null,
    },
    config,
    estandares,
    conocimiento,
    citaCreada: null,
    huecosOfrecidos: [],
  };
}

// El botón «Probar» de la vista Estándares: el asistente redacta y se valida igual que en
// producción, pero sin reservar, sin dejar solicitudes y sin escribirle a nadie.

Deno.serve(async (peticion) => {
  if (peticion.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (peticion.method !== "POST") return respuesta({ error: "método no permitido" }, 405);

  const correo = await quien(peticion);
  if (!correo) return respuesta({ error: "sin permiso" }, 401);

  let cuerpo: Record<string, any> = {};
  try {
    cuerpo = await peticion.json();
  } catch {
    return respuesta({ error: "json inválido" }, 400);
  }

  const accion = String(cuerpo.accion || "");

  try {
    // ── Conversaciones ────────────────────────────────────────────────────
    if (accion === "enviar") {
      const waId = String(cuerpo.wa_id || "");
      const texto = String(cuerpo.texto || "").trim();
      if (!waId || !texto) return respuesta({ error: "faltan wa_id o texto" }, 400);

      const id = await enviarTexto(waId, texto);
      await guardarMensajePropio(waId, texto, "equipo", id, correo);
      await marcarConversacion(waId, { atencion: null });
      await anotar("info", "panel", "mensaje enviado a mano", { por: correo }, waId);
      return respuesta({ ok: true, wa_message_id: id });
    }

    if (accion === "tomar") {
      const waId = String(cuerpo.wa_id || "");
      const estado = cuerpo.estado === "humano" ? "humano" : "bot";
      if (!waId) return respuesta({ error: "falta wa_id" }, 400);
      await marcarConversacion(waId, { estado, ...(estado === "bot" ? { atencion: null } : {}) });
      await anotar("info", "panel", `conversación en modo ${estado}`, { por: correo }, waId);
      return respuesta({ ok: true, estado });
    }

    if (accion === "resolver_solicitud") {
      const id = Number(cuerpo.id ?? 0);
      if (!id) return respuesta({ error: "falta id" }, 400);
      await db()
        .from("lr_suite_agenda_solicitudes")
        .update({ estado: "resuelta", resuelta_at: new Date().toISOString(), resuelta_por: correo })
        .eq("id", id);
      return respuesta({ ok: true });
    }

    // ── Huecos (para el selector del panel) ───────────────────────────────
    if (accion === "huecos") {
      const config = await leerConfig();
      const duracion = Number(cuerpo.duracion_min ?? config.duracion_default_min);
      const { data, error } = await db().rpc("lr_suite_agenda_huecos", {
        p_desde: cuerpo.desde ?? null,
        p_dias: Number(cuerpo.dias ?? 7),
        p_duracion_min: duracion,
      });
      if (error) throw new Error(error.message);

      let libres = (data ?? []) as { inicio: string; fin: string }[];
      if (config.calendar_id && libres.length) {
        const franjas = await ocupado(
          new Date(libres[0].inicio),
          new Date(libres[libres.length - 1].fin),
          config.calendar_id,
        );
        libres = libres.filter((h) => !pisa(h.inicio, h.fin, franjas));
      }
      return respuesta({ ok: true, huecos: libres, duracion_min: duracion });
    }

    // ── Citas: la base manda y Google Calendar refleja ────────────────────
    if (accion === "crear_cita") {
      const config = await leerConfig();
      const duracion = Number(cuerpo.duracion_min ?? config.duracion_default_min);
      const inicio = String(cuerpo.inicio || "");
      if (!Date.parse(inicio)) return respuesta({ error: "inicio inválido" }, 400);

      const { data, error } = await db().rpc("lr_suite_agenda_reservar", {
        p_inicio: inicio,
        p_duracion_min: duracion,
        p_tipo: cuerpo.tipo || "reunion",
        p_nombre: String(cuerpo.nombre || "").trim(),
        p_marca: cuerpo.marca ?? null,
        p_wa_id: cuerpo.wa_id ?? null,
        p_telefono: cuerpo.telefono ?? cuerpo.wa_id ?? null,
        p_correo: cuerpo.correo ?? null,
        p_motivo: cuerpo.motivo ?? null,
        p_diagnostico: cuerpo.diagnostico ?? {},
        p_origen: "equipo",
        // El equipo puede anotar algo fuera del horario de atención a propósito; pisar otra cita
        // confirmada sigue siendo imposible.
        p_forzar: cuerpo.forzar !== false,
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) return respuesta({ ok: false, motivo: data?.motivo ?? "no_se_pudo" });

      const cita = data.cita;
      const fin = new Date(Date.parse(inicio) + duracion * 60_000).toISOString();
      if (config.calendar_id) {
        const evento = await crearEvento({
          calendarId: config.calendar_id,
          inicio,
          fin,
          titulo: `${cuerpo.marca ? `${cuerpo.marca} · ` : ""}${cuerpo.nombre || "Reunión"}`,
          descripcion: [
            cuerpo.motivo ? `Motivo: ${cuerpo.motivo}` : "",
            cuerpo.wa_id ? `WhatsApp: +${cuerpo.wa_id}` : "",
            `Anotada desde LR Suite por ${correo}.`,
          ].filter(Boolean).join("\n"),
          zonaHoraria: config.zona_horaria,
          correo: cuerpo.correo ?? null,
          conMeet: cuerpo.con_meet !== false,
        });
        await db()
          .from("lr_suite_agenda_citas")
          .update({ google_event_id: evento.id, meet_url: evento.meet })
          .eq("id", cita.id);
        cita.google_event_id = evento.id;
        cita.meet_url = evento.meet;
      }
      return respuesta({ ok: true, cita });
    }

    if (accion === "mover_cita") {
      const config = await leerConfig();
      const inicio = String(cuerpo.inicio || "");
      if (!cuerpo.cita_id || !Date.parse(inicio)) {
        return respuesta({ error: "faltan cita_id o inicio" }, 400);
      }
      const { data, error } = await db().rpc("lr_suite_agenda_mover", {
        p_cita_id: cuerpo.cita_id,
        p_inicio: inicio,
        p_duracion_min: cuerpo.duracion_min ?? null,
        p_forzar: cuerpo.forzar !== false,
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) return respuesta({ ok: false, motivo: data?.motivo ?? "no_se_pudo" });

      const cita = data.cita;
      if (config.calendar_id && cita.google_event_id) {
        await moverEvento(
          config.calendar_id,
          cita.google_event_id,
          cita.inicio,
          cita.fin,
          config.zona_horaria,
        );
      }
      return respuesta({ ok: true, cita });
    }

    if (accion === "cancelar_cita") {
      const config = await leerConfig();
      if (!cuerpo.cita_id) return respuesta({ error: "falta cita_id" }, 400);

      const { data, error } = await db().rpc("lr_suite_agenda_cancelar", {
        p_cita_id: cuerpo.cita_id,
        p_motivo: cuerpo.motivo ?? `Cancelada desde LR Suite por ${correo}`,
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) return respuesta({ ok: false, motivo: data?.motivo ?? "no_se_pudo" });

      const cita = data.cita;
      if (config.calendar_id && cita.google_event_id) {
        await borrarEvento(config.calendar_id, cita.google_event_id);
      }
      return respuesta({ ok: true, cita });
    }

    // ── Probar los estándares sin enviar nada ─────────────────────────────
    if (accion === "probar") {
      const mensaje = String(cuerpo.mensaje || "").trim();
      if (!mensaje) return respuesta({ error: "falta mensaje" }, 400);

      // Con wa_id se prueba sobre la conversación real (sin escribirle); sin él, en seco.
      const waId = String(cuerpo.wa_id || "prueba");
      const ctx = { ...(await contexto(waId)), prueba: true };
      const previos = cuerpo.wa_id ? await historial(waId, 10) : [];

      const borrador = await redactar(ctx, [...previos, { rol: "cliente", texto: mensaje }]);
      const duras = reglasDuras(borrador, ctx);
      const delRevisor = borrador ? await revisar(borrador, ctx) : [];
      const observaciones = [...duras, ...delRevisor];

      return respuesta({
        ok: true,
        borrador,
        veredicto: observaciones.length ? "frenado" : "aprobado",
        observaciones,
        reservo: ctx.citaCreada,
      });
    }

    return respuesta({ error: `acción desconocida: ${accion}` }, 400);
  } catch (error) {
    await anotar("error", "panel", `acción ${accion} falló`, { error: String(error), por: correo });
    return respuesta({ error: String(error) }, 500);
  }
});
