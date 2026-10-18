// Piezas comunes de las dos funciones: secretos, cliente de Supabase y bitácora.
//
// Los secretos se cargan con `supabase secrets set` y nunca viven en el repositorio, que es
// público. La service_role key solo existe aquí, en el servidor: el navegador jamás la ve.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function secreto(nombre: string, obligatorio = true): string {
  const valor = Deno.env.get(nombre) ?? "";
  if (!valor && obligatorio) throw new Error(`Falta el secreto ${nombre}`);
  return valor;
}

let cliente: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cliente) return cliente;
  cliente = createClient(
    secreto("SUPABASE_URL"),
    secreto("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cliente;
}

export type Nivel = "info" | "error";
export type Origen = "webhook" | "claude" | "validacion" | "calendar" | "panel";

// La bitácora alimenta la tira de estado del módulo. Si falla no se interrumpe la conversación:
// un bot que deja de contestar porque no pudo escribir su log es peor que un log incompleto.
export async function anotar(
  nivel: Nivel,
  origen: Origen,
  evento: string,
  detalle: Record<string, unknown> = {},
  waId: string | null = null,
) {
  try {
    await db().from("lr_suite_agenda_log").insert({
      nivel,
      origen,
      evento,
      wa_id: waId,
      detalle,
    });
  } catch (error) {
    console.error("No se pudo anotar en la bitácora:", error);
  }
  if (nivel === "error") console.error(`[${origen}] ${evento}`, detalle);
}

// Texto plano para el modelo: nada de objetos enormes dentro del prompt.
export function lista(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.map((item) => String(item ?? "").trim()).filter(Boolean);
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
