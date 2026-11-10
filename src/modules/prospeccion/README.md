# ACRM (`id: "prospeccion"`)

Módulo del `index.html` que lleva un prospecto desde la captura hasta la venta, en una sola página: la
tabla maestra de leads con la ficha de cada uno (acciones, cotización, hilo y su agente).
`acrmLeadsModule()` arma la página y monta las piezas:

| Archivo | Qué hace |
| --- | --- |
| `acrm-panel.js` / `.css` | Cola de próximas acciones, embudo y metas en la barra del título, marcador de quién va ganando y la puerta del agente IA. |
| `contactos-propios.js` | Lista compartida de contactos de LinkedIn con reserva antes del primer mensaje. |
| `acrm-leads.js` | Datos de la tabla maestra de leads: página desde el embudo, cifras, hilo y las escrituras del perfil (la pantalla es `acrmLeadsModule()` del `index.html`). |
| `acrm-ficha.js` | Protocolo del agente de la ficha de cada lead (función `acrm-ficha`): la ficha que se le cuenta, lectura y validación de sus propuestas, y el turno siguiente. |
| `acrm-cotizaciones.js` | Puente entre `lr_acrm_cotizaciones` y la sección Cotizaciones (la pantalla sigue en `quotesModule()` del `index.html`). |
| `investigacion-integrada.css` | Estilos `research-*` que usan la lista y la cola. |

Cómo funciona cada parte, qué tablas usa y qué falta: `ACRM-CONTACTABILIDAD.md`. Las pruebas están
en `tests/acrm/`.

## Lo que se retiró

La lista propia de prospectos (tabla `lr_suite_prospectos`, `BBDD/prospeccion.sql`), con sus estados,
formulario, contactabilidad y exportador CSV, dejó de dibujarse cuando llegó el ACRM y su código se
retiró del `index.html` en noviembre de 2026. Lo mismo la vista «Investigación y búsqueda»
(`investigacion-integrada.js`), que ya no se cargaba. La tabla sigue en Supabase con sus datos: no se
borró. Los SQL de `BBDD/` quedan como registro de lo que se aplicó.
