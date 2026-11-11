// Lo que cuesta cada llamada al modelo, anotado en el momento de hacerla.
//
// Las cuatro funciones que hablan con Anthropic (pendientes-agente, gasto-agente, acrm-agente y el
// asistente de WhatsApp) pasan por aquí después de recibir la respuesta. Una fila por llamada en
// lr_suite_agente_uso, y de ahí sale el módulo «Agentes IA» de la Suite.
//
// Por qué el costo se calcula aquí y no al leer el tablero: los precios cambian. Si se calculara al
// mirar, el gasto de marzo se recalcularía con los precios de agosto y las cifras de un mes cerrado
// cambiarían solas. Aquí queda congelado.
//
// Como la bitácora: si esto falla, la conversación sigue. Un agente que deja de contestar porque no
// pudo anotar su costo es peor que un registro con un agujero.
import { db } from "./base.ts";

// Dólares por millón de tokens, de platform.claude.com/docs/en/about-claude/pricing
// (consultados el 2026-11-11). La escritura de caché es la de 5 minutos, que es la que usa el SDK
// por omisión. Si algún día se cambia el modelo de un agente por secreto, basta con añadir su fila.
type Precio = { entrada: number; salida: number; cacheLee: number; cacheEscribe: number };

const PRECIOS: Record<string, Precio> = {
  "claude-sonnet-5-5": { entrada: 2, salida: 10, cacheLee: 0.1, cacheEscribe: 2.5 },
  "claude-sonnet-5": { entrada: 2, salida: 10, cacheLee: 0.2, cacheEscribe: 2.5 },
  "claude-opus-5-5": { entrada: 4, salida: 20, cacheLee: 0.2, cacheEscribe: 5 },
  "claude-opus-5": { entrada: 5, salida: 25, cacheLee: 0.5, cacheEscribe: 6.25 },
  "claude-haiku-5-5": { entrada: 0.1, salida: 0.5, cacheLee: 0.01, cacheEscribe: 0.125 },
};

// Un modelo que no esté en la lista no puede costar cero: eso escondería el gasto justo cuando
// alguien acaba de cambiar el modelo por secreto. Se cobra como Sonnet y el tablero lo marcará
// porque el nombre del modelo sale tal cual en la fila.
const POR_DEFECTO: Precio = PRECIOS["claude-sonnet-5-5"];

// $10 por cada 1.000 búsquedas. Una búsqueda que falla no se cobra, pero la API tampoco la cuenta.
const PRECIO_BUSQUEDA = 0.01;

// Los seis sitios desde los que la Suite llama al modelo. «whatsapp» es el asistente comercial,
// «ficha» el que prepara la ficha de un lead y «reglas» el análisis de reglas: estos dos no
// conversan con nadie, se disparan solos, y por eso mismo conviene verlos en el tablero.
export type Agente = "pendientes" | "gasto" | "prospeccion" | "whatsapp" | "ficha" | "reglas";

// Lo que devuelve la API en `usage`. Va suelto porque los campos nuevos pueden no estar en los
// tipos de la versión del SDK que resuelva Deno, y un desajuste no debe tumbar el despliegue.
type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number; code_execution_requests?: number };
};

const entero = (valor: unknown): number => {
  const numero = Math.round(Number(valor));
  return Number.isFinite(numero) && numero > 0 ? numero : 0;
};

export function costoDe(modelo: string, usage: Usage): number {
  const precio = PRECIOS[modelo] ?? POR_DEFECTO;
  const porMillon = (tokens: number, tarifa: number) => (tokens / 1_000_000) * tarifa;
  return (
    porMillon(entero(usage?.input_tokens), precio.entrada) +
    porMillon(entero(usage?.output_tokens), precio.salida) +
    porMillon(entero(usage?.cache_read_input_tokens), precio.cacheLee) +
    porMillon(entero(usage?.cache_creation_input_tokens), precio.cacheEscribe) +
    entero(usage?.server_tool_use?.web_search_requests) * PRECIO_BUSQUEDA
  );
}

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
