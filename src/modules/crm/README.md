# CRM

Une en una sola ficha por persona lo que la Suite ya sabe de cada contacto comercial, que hoy
está repartido en cinco lugares que no se conocen:

| Fuente                                      | Qué aporta                            | Cómo identifica   |
| ------------------------------------------- | ------------------------------------- | ----------------- |
| `mc_leads` (webhook de ManyChat)            | Lead de Ads                           | teléfono, correo  |
| `lr_suite_prospectos` (Prospección)         | Prospección en LinkedIn               | perfil, correo    |
| `lr_suite_agenda_conversaciones` (Agenda)   | Chat con el asistente de WhatsApp     | `wa_id`           |
| `lr_suite_agenda_citas` (Agenda)            | Reunión agendada                      | teléfono, correo  |
| `lr_suite_private_data` clave `quotes`      | Cotización                            | teléfono, correo  |

Con eso se puede seguir a una persona desde el anuncio hasta la venta y medir el embudo
completo por origen.

## Fases

1. **Modelo y cruce (esta fase).** SQL en `BBDD/crm.sql`. No toca las fuentes ni el `index.html`:
   las lee, reconoce a la misma persona y deja vistas de solo lectura para validar que los cruces
   salen bien. Ver `BBDD/README.md`.
2. **Embudo y ficha en el panel.** Módulo con el tablero por etapa, la ficha de cada contacto con su
   historia y la revisión de duplicados. Aquí entran las oportunidades editables y las cotizaciones
   pasan del JSON de `lr_suite_private_data` a una tabla propia ligada al contacto.
3. **Ingesta automática.** Triggers en las fuentes (o pg_cron) para que cada lead, chat, cita o
   cotización nueva entre al CRM sin pulsar nada; la pieza se registra en Control de Automatización.
   Las cadencias de seguimiento (hoy solo en Cotizaciones: días 1, 3, 5, 12, 19, 26, 41 y 56) pasan
   a todo el embudo y generan tareas en Pendientes.
4. **Métricas e IA.** Conversión y tiempo por etapa, CAC real (la inversión en Meta y Google de P&G
   entre los clientes ganados) y un asistente para resumir el contacto y sugerir el siguiente paso, con
   el mismo patrón de `supabase/functions/_shared/asistente.ts`: Claude redacta, reglas fijas, un
   segundo pase de revisión y una persona aprueba.

## Un solo embudo

`lead` → `contactado` → `calificado` → `reunion` → `propuesta` → `negociacion` → `ganado`,
y `perdido` aparte.

| Fuente       | Etapa de la fuente                                        | Etapa del CRM |
| ------------ | --------------------------------------------------------- | ------------- |
| ManyChat     | (cualquiera)                                              | `lead`        |
| LinkedIn     | `por_contactar`                                           | `lead`        |
| LinkedIn     | `invitacion_enviada`, `conectado`, `info_enviada`         | `contactado`  |
| LinkedIn     | `respondio`                                               | `calificado`  |
| LinkedIn     | `reunion` / `cliente` / `descartado`                      | `reunion` / `ganado` / `perdido` |
| WhatsApp     | `nuevo`, `cerrado`                                        | `contactado`  |
| WhatsApp     | `diagnostico`, `asesoria`, `propuesta`, `datos`           | `calificado`  |
| WhatsApp     | `agendado`                                                | `reunion`     |
| Cita         | `confirmada`, `atendida`, `no_asistio` / `cancelada`      | `reunion` / `calificado` |
| Cotización   | Enviado / En revisión / Aprobado (las reglas de `quoteEstado()`) | `propuesta` / `negociacion` / `ganado` |

La etapa de un contacto es `ganado` si algo se ganó; `perdido` si lo último que pasó fue perderlo;
si no, la más avanzada a la que llegó. La tabla vive en una sola función,
`lr_suite_crm_etapa()`: una equivalencia que no convenza se cambia ahí.

## Origen

El del primer registro que lo dice: `ads` (ManyChat o cotización con origen Ads), `linkedin`,
`whatsapp` (escribió directo o el asistente agendó) o `referido`. Si alguien fue primero lead de Ads
y después pidió cotización, su origen es `ads`.
