// Lo que cobra Anthropic, y nada más.
//
// Vive aparte de uso.ts porque hay funciones que no pueden importar uso.ts: acrm-priorizar tiene su
// propio deno.json sin mapa de importaciones, así que un `@supabase/supabase-js` suelto no le
// resuelve. Este archivo no importa nada, así que lo puede usar cualquiera. Y así la tabla de
// precios sigue siendo una sola: dos copias acabarían diciendo cosas distintas el día que suba
// alguno.
//
// Dólares por millón de tokens, de platform.claude.com/docs/en/about-claude/pricing (consultados el
// 2026-11-11). La escritura de caché es la de 5 minutos, que es la que usa el SDK por omisión.
export type Precio = { entrada: number; salida: number; cacheLee: number; cacheEscribe: number };

export const PRECIOS: Record<string, Precio> = {
  "claude-sonnet-5-5": { entrada: 2, salida: 10, cacheLee: 0.1, cacheEscribe: 2.5 },
  "claude-sonnet-5": { entrada: 2, salida: 10, cacheLee: 0.2, cacheEscribe: 2.5 },
  "claude-opus-5-5": { entrada: 4, salida: 20, cacheLee: 0.2, cacheEscribe: 5 },
  "claude-opus-5": { entrada: 5, salida: 25, cacheLee: 0.5, cacheEscribe: 6.25 },
  "claude-haiku-5-5": { entrada: 0.1, salida: 0.5, cacheLee: 0.01, cacheEscribe: 0.125 },
};

// Un modelo que no esté en la lista no puede costar cero: eso escondería el gasto justo cuando
// alguien acaba de cambiar el modelo por secreto. Se cobra como Sonnet y el tablero lo marca
// porque el nombre del modelo sale tal cual en la fila.
export const POR_DEFECTO: Precio = PRECIOS["claude-sonnet-5-5"];

// $10 por cada 1.000 búsquedas. Una búsqueda que falla no se cobra, pero la API tampoco la cuenta.
export const PRECIO_BUSQUEDA = 0.01;

// Lo que devuelve la API en `usage`. Va suelto porque los campos nuevos pueden no estar en los
// tipos de la versión del SDK que resuelva Deno, y un desajuste no debe tumbar el despliegue.
export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number; code_execution_requests?: number };
};

export const entero = (valor: unknown): number => {
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
