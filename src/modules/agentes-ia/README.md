# Agentes IA

El tablero de los agentes de la casa: quiénes son, qué tiene cargado cada uno y qué cuesta.

```txt
Edge Function ──► lr_suite_agente_uso        (una fila por llamada, costo congelado)
      ▲                      │
      │                      └──► lr_suite_agentes_panel() ──► index.html (la lista)
      │
      └── lr_suite_agente_recurso ◄── lr_suite_agente_recurso_op() ◄── index.html (la ficha)
          (prompts, documentos y enlaces que la función lee en cada llamada)
```

## Las dos mitades

**El recibo.** Cada función que habla con Anthropic anota su llamada con el costo ya calculado al
precio del momento (`supabase/functions/_shared/precios.ts`). El navegador no lee esa tabla: pide
el resumen ya sumado por Postgres. El plan de Supabase es el gratuito y el egress se paga mirando.

**El material.** Lo que el equipo le carga a un agente desde la ficha —prompts, documentos y
enlaces— lo lee su Edge Function en cada llamada y se pega **al final** de su prompt de sistema
(`supabase/functions/_shared/recursos.ts`), en un bloque marcado como material de referencia. No
reemplaza nada del código: las herramientas, los límites y el formato de la respuesta siguen siendo
TypeScript, porque eso no se puede romper desde un navegador.

| Tipo       | Qué le llega al modelo                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| Prompt     | El texto tal cual, como instrucción añadida.                                     |
| Documento  | El texto pegado, para citarlo. Sin texto, solo la referencia: la Suite no descarga archivos de Drive. |
| Enlace     | La URL con su descripción. El agente la conoce y la puede dar; solo la visita si tiene búsqueda web. |

Cada recurso admite 20.000 caracteres y el bloque entero se corta a 40.000: todo eso viaja en
**cada** llamada y se paga como tokens de entrada. La ficha muestra cuántos caracteres lleva encima
el agente, justamente por eso.

## Los agentes del catálogo

| Clave        | Función                | Dónde vive                              |
| ------------ | ---------------------- | --------------------------------------- |
| `pendientes` | `pendientes-agente`    | Módulo Pendientes                       |
| `gasto`      | `gasto-agente`         | Módulo Alertas de Gasto                 |
| `prospeccion`| `acrm-agente`          | Módulo ACRM, la cola                    |
| `ficha`      | `acrm-ficha`           | Módulo ACRM, ficha del lead             |
| `priorizar`  | `acrm-priorizar`       | Módulo ACRM, botón «Prioridad IA»       |
| `whatsapp`   | `whatsapp`             | WhatsApp Cloud API                      |
| `reglas`     | `reglas-analisis`      | Módulo Reglas                           |

La clave del catálogo tiene que ser **exactamente** la que la función pasa a `registrarUso()`. Si
no coincide, el gasto aparece suelto en el tablero, marcado como «sin ficha», y no se le puede
cargar material.

## Lo que el tablero no sabe

- **La ejecución de código** se cobra por tiempo de contenedor (1.550 horas gratis al mes), así que
  se cuenta pero no se suma: meter una estimación haría que el tablero mintiera hacia arriba.
- **Apagar un agente** en su ficha es una etiqueta, no un interruptor: lo que lo desconecta de
  verdad es su secreto o su código.
- **La consola de Anthropic** sigue siendo la verdad del recibo. Esto es el desglose por agente,
  por persona y por día que allá no existe, porque allá todo son llamadas de la misma clave.
