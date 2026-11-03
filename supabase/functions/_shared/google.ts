// Google Calendar: free/busy para no ofrecer horas ocupadas, y el evento de la reunión.
//
// Autenticación: refresh token OAuth de la cuenta dueña del calendario «Agenda Lima Retail»
// (un consentimiento único, guardado como secreto). Es el camino que permite invitar al cliente
// por correo y crear el enlace de Meet; una cuenta de servicio no puede invitar invitados sin
// delegación de dominio.
import { secreto } from "./base.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL = "https://www.googleapis.com/calendar/v3";

let token = "";
let tokenVence = 0;

async function accessToken(): Promise<string> {
  if (token && Date.now() < tokenVence - 60_000) return token;

  const respuesta = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: secreto("GOOGLE_CLIENT_ID"),
      client_secret: secreto("GOOGLE_CLIENT_SECRET"),
      refresh_token: secreto("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });

  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok || !cuerpo.access_token) {
    throw new Error(
      `Google no renovó el acceso: ${cuerpo.error_description || cuerpo.error || respuesta.status}`,
    );
  }
  token = cuerpo.access_token;
  tokenVence = Date.now() + Number(cuerpo.expires_in ?? 3600) * 1000;
  return token;
}

async function llamar(ruta: string, init: RequestInit = {}): Promise<any> {
  const respuesta = await fetch(`${CAL}${ruta}`, {
    ...init,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const cuerpo = respuesta.status === 204 ? {} : await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(`Google Calendar: ${cuerpo?.error?.message || `HTTP ${respuesta.status}`}`);
  }
  return cuerpo;
}

export type Ocupado = { inicio: number; fin: number };

// Calendarios a consultar: el de la agenda y el principal de la cuenta, para que una reunión
// personal también bloquee el hueco.
export async function ocupado(
  desde: Date,
  hasta: Date,
  calendarId: string,
): Promise<Ocupado[]> {
  const ids = [calendarId, "primary"].filter(Boolean);
  const extra = (Deno.env.get("GOOGLE_CALENDARIOS_EXTRA") || "")
    .split(",").map((id) => id.trim()).filter(Boolean);

  const cuerpo = await llamar("/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin: desde.toISOString(),
      timeMax: hasta.toISOString(),
      items: [...new Set([...ids, ...extra])].map((id) => ({ id })),
    }),
  });

  const franjas: Ocupado[] = [];
  for (const calendario of Object.values(cuerpo.calendars ?? {}) as any[]) {
    for (const franja of calendario?.busy ?? []) {
      const inicio = Date.parse(franja.start);
      const fin = Date.parse(franja.end);
      if (Number.isFinite(inicio) && Number.isFinite(fin)) franjas.push({ inicio, fin });
    }
  }
  return franjas;
}

export function pisa(inicioISO: string, finISO: string, franjas: Ocupado[]): boolean {
  const inicio = Date.parse(inicioISO);
  const fin = Date.parse(finISO);
  return franjas.some((franja) => inicio < franja.fin && fin > franja.inicio);
}

export type EventoNuevo = {
  calendarId: string;
  inicio: string;
  fin: string;
  titulo: string;
  descripcion: string;
  zonaHoraria: string;
  correo?: string | null;
  conMeet?: boolean;
};

export async function crearEvento(evento: EventoNuevo): Promise<{ id: string; meet: string | null }> {
  const cuerpo = await llamar(
    `/calendars/${encodeURIComponent(evento.calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: "POST",
      body: JSON.stringify({
        summary: evento.titulo,
        description: evento.descripcion,
        start: { dateTime: evento.inicio, timeZone: evento.zonaHoraria },
        end: { dateTime: evento.fin, timeZone: evento.zonaHoraria },
        ...(evento.correo ? { attendees: [{ email: evento.correo }] } : {}),
        ...(evento.conMeet === false ? {} : {
          conferenceData: {
            createRequest: {
              requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }),
      }),
    },
  );

  return {
    id: String(cuerpo.id || ""),
    meet: cuerpo.hangoutLink || cuerpo.conferenceData?.entryPoints?.[0]?.uri || null,
  };
}

export async function moverEvento(
  calendarId: string,
  eventId: string,
  inicio: string,
  fin: string,
  zonaHoraria: string,
) {
  await llamar(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "PATCH",
      body: JSON.stringify({
        start: { dateTime: inicio, timeZone: zonaHoraria },
        end: { dateTime: fin, timeZone: zonaHoraria },
      }),
    },
  );
}

export async function borrarEvento(calendarId: string, eventId: string) {
  const respuesta = await fetch(
    `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "DELETE", headers: { authorization: `Bearer ${await accessToken()}` } },
  );
  // 410 = ya estaba borrado: para nosotros es el mismo resultado.
  if (!respuesta.ok && respuesta.status !== 404 && respuesta.status !== 410) {
    throw new Error(`Google Calendar no borró el evento: HTTP ${respuesta.status}`);
  }
}
