// WhatsApp Cloud API: comprobar que el webhook viene de Meta y enviar mensajes.
import { secreto } from "./base.ts";

const GRAPH = () => Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v22.0";

// Meta firma cada POST con el App Secret. Sin esta comprobación cualquiera podría escribirle a
// nuestro webhook y hacer hablar al asistente en nombre de cualquier número.
export async function firmaValida(cuerpo: string, cabecera: string | null): Promise<boolean> {
  const esperado = (cabecera || "").trim();
  if (!esperado.startsWith("sha256=")) return false;

  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto("META_APP_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(cuerpo));
  const calculado = "sha256=" +
    Array.from(new Uint8Array(firma)).map((b) => b.toString(16).padStart(2, "0")).join("");

  // Comparación de tiempo constante: no se filtra por dónde dejan de coincidir.
  if (calculado.length !== esperado.length) return false;
  let diferencia = 0;
  for (let i = 0; i < calculado.length; i += 1) {
    diferencia |= calculado.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diferencia === 0;
}

export type Entrante = {
  waId: string;
  nombre: string | null;
  texto: string;
  waMessageId: string;
};

// Del payload de Meta solo nos interesan los mensajes de texto. Los estados de entrega
// (sent/delivered/read) y los adjuntos se ignoran, pero se reconocen para no tratarlos como error.
export function mensajesEntrantes(payload: unknown): Entrante[] {
  const salida: Entrante[] = [];
  const entradas = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entradas)) return salida;

  for (const entrada of entradas) {
    const cambios = (entrada as { changes?: unknown[] })?.changes;
    if (!Array.isArray(cambios)) continue;
    for (const cambio of cambios) {
      const valor = (cambio as { value?: Record<string, unknown> })?.value ?? {};
      const contactos = Array.isArray(valor.contacts) ? valor.contacts : [];
      const mensajes = Array.isArray(valor.messages) ? valor.messages : [];
      for (const mensaje of mensajes) {
        const m = mensaje as Record<string, any>;
        const waId = String(m.from || "").trim();
        const waMessageId = String(m.id || "").trim();
        if (!waId || !waMessageId) continue;

        const texto = m.type === "text"
          ? String(m.text?.body || "").trim()
          : m.type === "button"
          ? String(m.button?.text || "").trim()
          : m.type === "interactive"
          ? String(
            m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "",
          ).trim()
          : "";

        const nombre = String(
          (contactos[0] as Record<string, any>)?.profile?.name || "",
        ).trim() || null;

        salida.push({ waId, nombre, texto, waMessageId });
      }
    }
  }
  return salida;
}

export async function enviarTexto(waId: string, texto: string): Promise<string | null> {
  const respuesta = await fetch(
    `https://graph.facebook.com/${GRAPH()}/${secreto("WHATSAPP_PHONE_ID")}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${secreto("WHATSAPP_TOKEN")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: waId,
        type: "text",
        text: { preview_url: false, body: texto.slice(0, 4000) },
      }),
    },
  );

  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const detalle = cuerpo?.error?.message || `HTTP ${respuesta.status}`;
    throw new Error(`WhatsApp rechazó el mensaje: ${detalle}`);
  }
  return cuerpo?.messages?.[0]?.id ?? null;
}
