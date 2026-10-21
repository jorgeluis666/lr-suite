// Webhook de WhatsApp: lo que Meta llama cada vez que alguien escribe al número de la agencia.
//
// Despliegue: supabase functions deploy whatsapp --no-verify-jwt
// (tiene que ser pública: la llama Meta, no un usuario con sesión; la autenticidad se comprueba
// con la firma del App Secret, no con JWT).
import { anotar, corrida, db, erroresDesde, secreto } from "../_shared/base.ts";
import { firmaValida, enviarTexto, mensajesEntrantes, type Entrante } from "../_shared/whatsapp.ts";
import {
  abrirConversacion,
  anotarRevision,
  guardarMensajeCliente,
  guardarMensajePropio,
  historial,
  leerConfig,
  leerConocimiento,
  leerEstandares,
  marcarConversacion,
} from "../_shared/datos.ts";
import { responder, type Contexto } from "../_shared/asistente.ts";

const SIN_TEXTO =
  "Por ahora solo puedo leer mensajes de texto. Cuéntame en un mensaje qué necesitas y te ayudo; " +
  "si es un archivo, lo revisa alguien del equipo.";

// inicio: el reloj de esta atención. Con él se miden las corridas que ve el Control de
// Automatización y se sabe qué errores de la bitácora son de este mensaje y no de otro.
async function atender(entrante: Entrante, inicio: number) {
  const conversacion = await abrirConversacion(entrante.waId, entrante.nombre);

  // Mensaje que no es texto: se guarda, se responde con una línea nuestra y lo ve una persona.
  if (!entrante.texto) {
    const nuevo = await guardarMensajeCliente(entrante.waId, "(adjunto)", entrante.waMessageId);
    if (!nuevo) return;
    await corrida("asistente-webhook", "ok", inicio, { mensaje: "adjunto" });
    await db().from("lr_suite_agenda_solicitudes").insert({
      wa_id: entrante.waId,
      tipo: "otro",
      detalle: "Envió un archivo o nota de voz; el asistente no los lee.",
    });
    await marcarConversacion(entrante.waId, { atencion: "solicitud" });
    const id = await enviarTexto(entrante.waId, SIN_TEXTO);
    await guardarMensajePropio(entrante.waId, SIN_TEXTO, "asistente", id);
    return;
  }

  // Idempotencia: Meta reintenta el mismo webhook y no se contesta dos veces lo mismo.
  const nuevo = await guardarMensajeCliente(entrante.waId, entrante.texto, entrante.waMessageId);
  if (!nuevo) {
    await anotar("info", "webhook", "mensaje repetido, ignorado", {
      wa_message_id: entrante.waMessageId,
    }, entrante.waId);
    return;
  }
  await corrida("asistente-webhook", "ok", inicio, { mensaje: "texto" });

  const [config, estandares, conocimiento] = await Promise.all([
    leerConfig(),
    leerEstandares(),
    leerConocimiento(),
  ]);

  // El asistente calla si lo apagaron en el panel o si alguien tomó la conversación.
  if (!config.bot_activo || conversacion.estado === "humano") {
    await marcarConversacion(entrante.waId, { atencion: "solicitud" });
    await anotar("info", "webhook", "mensaje guardado sin responder", {
      motivo: conversacion.estado === "humano" ? "conversacion_humana" : "bot_apagado",
    }, entrante.waId);
    return;
  }

  const ctx: Contexto = {
    conversacion: { ...conversacion, nombre: entrante.nombre ?? conversacion.nombre },
    config,
    estandares,
    conocimiento,
    citaCreada: null,
    huecosOfrecidos: [],
  };

  const previos = await historial(entrante.waId, 20);
  const resultado = await responder(ctx, previos);

  const waMessageId = await enviarTexto(entrante.waId, resultado.texto);
  await guardarMensajePropio(entrante.waId, resultado.texto, "asistente", waMessageId);
  await anotarRevision(
    entrante.waId,
    resultado.borrador,
    resultado.texto,
    resultado.veredicto,
    resultado.observaciones,
    resultado.intentos,
    config.modelo_validacion!,
  );

  await marcarConversacion(entrante.waId, {
    ...(resultado.citaCreada ? { etapa: "agendado" } : {}),
    ...(resultado.veredicto === "frenado" ? { atencion: "validacion" } : {}),
    ...(entrante.nombre ? { nombre: entrante.nombre } : {}),
  });

  await anotar("info", "webhook", "respondido", {
    veredicto: resultado.veredicto,
    intentos: resultado.intentos,
    cita: resultado.citaCreada?.etiqueta ?? null,
  }, entrante.waId);

  // Lo que el Control de Automatización verá de esta atención. El asistente y el calendario
  // anotan sus fallos en la bitácora y siguen contestando, así que se leen de ahí. Un borrador
  // frenado por el filtro no es un error: el filtro hizo su trabajo y queda en el detalle.
  const fallos = await erroresDesde(inicio, ["claude", "validacion", "calendar"]);
  const falloCalendar = fallos.find((fallo) => fallo.origen === "calendar") ?? null;
  const falloAsistente = fallos.find((fallo) => fallo.origen !== "calendar") ?? null;
  await corrida(
    "asistente-agenda",
    falloAsistente ? "error" : "ok",
    inicio,
    { veredicto: resultado.veredicto, intentos: resultado.intentos },
    falloAsistente?.evento ?? null,
  );
  if (falloCalendar || resultado.citaCreada) {
    await corrida(
      "asistente-calendar",
      falloCalendar ? "error" : "ok",
      inicio,
      { cita: resultado.citaCreada?.etiqueta ?? null },
      falloCalendar?.evento ?? null,
    );
  }

  // Limpieza de la bitácora de vez en cuando, para no necesitar otro pg_cron.
  if (Math.random() < 0.05) await db().rpc("lr_suite_agenda_log_limpiar", { p_dias: 30 });
}

async function procesar(payload: unknown) {
  for (const entrante of mensajesEntrantes(payload)) {
    const inicio = Date.now();
    try {
      await atender(entrante, inicio);
    } catch (error) {
      await anotar("error", "webhook", "no se pudo atender el mensaje", {
        error: String(error),
      }, entrante.waId);
      // En rojo la pieza que de verdad falló, según lo que alcanzó a quedar en la bitácora.
      const fallos = await erroresDesde(inicio, ["claude", "validacion", "calendar"]);
      const pieza = fallos.some((fallo) => fallo.origen === "calendar")
        ? "asistente-calendar"
        : fallos.length
          ? "asistente-agenda"
          : "asistente-webhook";
      await corrida(pieza, "error", inicio, {}, String(error).slice(0, 300));
      // El cliente no se queda en silencio por un fallo nuestro.
      try {
        const aviso = "Tuve un problema técnico. Ya quedó avisado el equipo y te responden en breve.";
        const id = await enviarTexto(entrante.waId, aviso);
        await guardarMensajePropio(entrante.waId, aviso, "asistente", id);
        await marcarConversacion(entrante.waId, { atencion: "error" });
      } catch (fallo) {
        await anotar("error", "webhook", "tampoco se pudo avisar al cliente", {
          error: String(fallo),
        }, entrante.waId);
      }
    }
  }
}

Deno.serve(async (peticion) => {
  const url = new URL(peticion.url);

  // Verificación del webhook: Meta pide el challenge una sola vez, al configurarlo.
  if (peticion.method === "GET") {
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (url.searchParams.get("hub.mode") === "subscribe" && token === secreto("WHATSAPP_VERIFY_TOKEN")) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("no", { status: 403 });
  }

  if (peticion.method !== "POST") return new Response("método no permitido", { status: 405 });

  const cuerpo = await peticion.text();
  if (!(await firmaValida(cuerpo, peticion.headers.get("x-hub-signature-256")))) {
    await anotar("error", "webhook", "firma inválida: petición descartada", {
      origen: peticion.headers.get("x-forwarded-for") ?? "",
    });
    return new Response("firma inválida", { status: 403 });
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(cuerpo);
  } catch {
    return new Response("json inválido", { status: 400 });
  }

  // Meta espera el 200 rápido o reintenta: la conversación sigue en segundo plano.
  const trabajo = procesar(payload);
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(trabajo);
  else await trabajo;

  return new Response("ok", { status: 200 });
});
