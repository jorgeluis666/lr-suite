# BBDD - Control de Automatización

## Instalación

Supabase > SQL Editor: ejecutar `control-automatizacion.sql` completo. Es idempotente y sirve aunque ya se
haya instalado la versión 1. Requiere `estado-perdidas-ganancias/BBDD/sincronizacion-google-sheets.sql` y
`analisis-palabras-clave/BBDD/sincronizacion-drive.sql`; no cambia sus tablas, funciones ni crons.

Supabase avisa "destructive operations" porque el script contiene `drop policy if exists`, `delete` y
`revoke`. Solo actúan sobre lo que crea este mismo script.

## Tabla `lr_suite_automation_components`

Una fila por pieza del proceso. Solo lectura para Jorge Luis y Diego (RLS con `is_lr_suite_pending_user()`);
se edita desde el SQL Editor. El script siembra las piezas de hoy con `on conflict do nothing`, así volver
a ejecutarlo no pisa los cambios.

| Campo | Uso |
| --- | --- |
| `id` | identificador (`financial`, `keywords`, `descarga-meta`…) |
| `stage` | `descarga`, `drive`, `carga` o `modulo` |
| `name`, `description` | lo que muestra el módulo |
| `brand`, `source` | marca (vacío = todas) y plataforma (`meta`, `google`…) |
| `status` | `activo`, `pendiente` o `pausado` |
| `cadence` | `diaria`, `semanal` o `mensual`: cuánto puede envejecer su dato |
| `cron_job` | job de pg_cron que la ejecuta; sus corridas salen de `cron.job_run_details` |
| `run_function` | función para «Ejecutar ahora»: recibe `(p_trigger text, p_requested_by text)` y devuelve `jsonb` |
| `data_key`, `data_path` | fila de `lr_suite_private_data` y ruta del timestamp de su último dato (p. ej. `{syncedAt}`) |
| `sort` | orden dentro de su etapa |

## Tabla `lr_suite_automation_runs`

Corridas registradas: las de «Ejecutar ahora» (`trigger` = `manual`) y las que anoten las automatizaciones
que no corren con pg_cron (`automatica`). `job` es el `id` de la pieza. Se conservan 180 días.

Campos: `requested_by`, `requested_at`, `scheduled_for`, `cron_job_name` (job de un solo uso), `status`
(`en_cola`, `ok`, `error`), `started_at`, `finished_at`, `duration_ms`, `rows_loaded`, `detail` (filas por
pestaña o archivos leídos, nunca los CSV) y `error_detail`.

## RPC

- `lr_suite_automation_status(p_history default 10)`: un JSON (~6 KB) con `serverNow`, los jobs de pg_cron
  usados (horario, activo, últimas corridas) y cada pieza con su último dato, su antigüedad (`ageHours`,
  medida con el reloj de la base de datos), sus corridas registradas y si se puede ejecutar a mano.
- `run_lr_suite_automation(p_job)`: pone en cola una corrida de una pieza activa con `run_function` y
  programa un job de pg_cron de un solo uso para el minuto siguiente. Si ya hay una en cola, devuelve esa.
- `lr_suite_automation_process(p_run_id)`: la llama ese job. Lo borra, ejecuta la `run_function` de la pieza
  y guarda el resultado, también si falla. No se puede llamar desde la API.
- `lr_suite_automation_log_run(...)`: para que una automatización nueva anote cada corrida. Disponible para
  `service_role` (por ejemplo, una Edge Function), no para el navegador.

## Sumar una automatización

1. Si ya existe su fila pendiente (por ejemplo `descarga-meta`), pasarla a activa:
   `update public.lr_suite_automation_components set status = 'activo', cron_job = '<job>', updated_at = now() where id = 'descarga-meta';`
2. Si es nueva, insertar su fila con su etapa, nombre, marca, fuente y `cron_job`. Para el botón «Ejecutar
   ahora», su `run_function`; para la frescura, su `data_key` y `data_path`.
3. Si no corre con pg_cron, que llame a `lr_suite_automation_log_run('<id>', 'ok' | 'error', inicio, fin,
   filas, detalle, error)` al terminar.

El módulo la muestra en su etapa en la siguiente lectura; no hace falta tocar el `index.html`.

## Egress

Una lectura de ~6 KB al abrir el módulo (como máximo cada 2 minutos) y cada 15 s solo mientras hay una
corrida en cola, hasta 12 minutos.
