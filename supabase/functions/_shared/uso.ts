// Lo que cuesta cada llamada al modelo, anotado en el momento de hacerla.
//
// Las funciones que hablan con Anthropic pasan por aquí después de recibir la respuesta. Una fila
// por llamada en lr_suite_agente_uso, y de ahí sale el módulo «Agentes IA» de la Suite.
// (acrm-priorizar es la excepción: tiene su propio deno.json sin mapa de importaciones, así que no
// puede importar este archivo y escribe su fila a mano con la misma tabla de precios.)
//
// Por qué el costo se calcula aquí y no al leer el tablero: los precios cambian. Si se calculara al
// mirar, el gasto de marzo se recalcularía con los precios de agosto y las cifras de un mes cerrado
// cambiarían solas. Aquí queda congelado.
//
// Como la bitácora: si esto falla, la conversación sigue. Un agente que deja de contestar porque no
// pudo anotar su costo es peor que un registro con un agujero.
import { db } from "./base.ts";
// La tabla de precios vive en precios.ts, sin importaciones de nadie, para que también la pueda
// usar acrm-priorizar, que no puede importar este archivo.
import { costoDe, entero, type Usage } from "./precios.ts";

export { costoDe };

// Los siete sitios desde los que la Suite llama al modelo. «whatsapp» es el asistente comercial;
// «ficha», «priorizar» y «reglas» no conversan con nadie, se disparan solos, y por eso mismo
// conviene verlos en el tablero. La lista es la misma que el catálogo de public.lr_suite_agente.
export type Agente =
  | "pendientes"
  | "gasto"
  | "prospeccion"
  | "whatsapp"
  | "ficha"
  | "reglas"
  | "priorizar";

export async function registrarUso(
  agente: Agente,
  datos: {
    modelo: string;
    usage: Usage | null | undefined;
    usuario?: string | null;
    esfuerzo?: string | null;
    // «chat» para la conversación normal. El asistente de WhatsApp usa además «revision» para el
    // segundo pase, el que comprueba los estándares antes de enviar.
    llamada?: string;
  },
) {
  const usage = datos.usage ?? {};
  try {
    const { error } = await db().from("lr_suite_agente_uso").insert({
      agente,
      llamada: (datos.llamada || "chat").slice(0, 40),
      usuario: datos.usuario ? String(datos.usuario).slice(0, 200) : null,
      modelo: String(datos.modelo || "desconocido").slice(0, 80),
      esfuerzo: datos.esfuerzo ? String(datos.esfuerzo).slice(0, 20) : null,
      entrada: entero(usage.input_tokens),
      salida: entero(usage.output_tokens),
      cache_lee: entero(usage.cache_read_input_tokens),
      cache_escribe: entero(usage.cache_creation_input_tokens),
      busquedas: entero(usage.server_tool_use?.web_search_requests),
      codigo: entero(usage.server_tool_use?.code_execution_requests),
      costo_usd: Number(costoDe(datos.modelo, usage).toFixed(6)),
    });
    if (error) console.error(`No se pudo anotar el uso de ${agente}:`, error.message);
  } catch (fallo) {
    console.error(`No se pudo anotar el uso de ${agente}:`, fallo);
  }
}
