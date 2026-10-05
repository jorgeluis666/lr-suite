# BBDD - Control de Automatización

## Instalación

Supabase > SQL Editor: ejecutar `control-automatizacion.sql` completo (es idempotente). Requiere que ya estén
instalados `estado-perdidas-ganancias/BBDD/sincronizacion-google-sheets.sql` y
`analisis-palabras-clave/BBDD/sincronizacion-drive.sql`. No cambia sus tablas, funciones ni crons.

## Tabla `lr_suite_automation_runs`

Una fila por cada re-ejecución pedida desde el módulo. Las corridas automáticas no se copian: se leen de
`cron.job_run_details`. Solo lectura para Jorge Luis y Diego (RLS con `is_lr_suite_pending_user()`); las
filas las escriben las funciones del script. Se conservan 180 días.

| Campo | Uso |
| --- | --- |
| `job` | `financial` o `keywords` |
| `trigger` | `manual` |
| `requested_by` | correo de quien pulsó «Re-ejecutar» |
| `requested_at`, `scheduled_for` | cuándo se pidió y para qué minuto quedó programada |
| `cron_job_name` | job de pg_cron de un solo uso (`lr-suite-automation-run-<id>`); se borra al correr |
| `status` | `en_cola`, `ok` o `error` |
| `started_at`, `finished_at`, `duration_ms` | ejecución |
| `rows_loaded` | P&G: filas con datos de las tres pestañas; Palabras clave: informes descargados bien |
| `detail` | P&G: filas por pestaña; Palabras clave: informes con su estado, avisos y si hubo cambios |
| `error_detail` | motivo, si falló (se conservan los datos anteriores) |

## RPC

- `lr_suite_automation_status(p_history default 10)`: un JSON (~5 KB) con `serverNow` y, por cada
  sincronización, su job de pg_cron (`schedule`, `active`), las últimas corridas automáticas, las últimas
  re-ejecuciones, el último dato guardado (fecha, origen, filas o informes, avisos) y `ageHours`, la
  antigüedad del dato medida con el reloj de la base de datos.
- `run_lr_suite_automation(p_job)`: pone en cola una re-ejecución y programa un job de pg_cron de un solo uso
  para el minuto siguiente (la descarga de Palabras clave no cabe en el tiempo máximo de una llamada a la
  API). Si ya hay una en cola para esa sincronización, devuelve esa.
- `lr_suite_automation_process(p_run_id)`: la llama el job de un solo uso. Lo borra, corre
  `lr_suite_financial_refresh('manual', …)` o `lr_suite_keywords_refresh('manual', …)` y guarda el resultado,
  también si falla. No se puede llamar desde la API.

## Egress

Una lectura de ~5 KB al abrir el módulo (como máximo cada 2 minutos) y cada 15 s solo mientras hay una
re-ejecución en cola, hasta 12 minutos. Lo de GitHub no pasa por Supabase.

## Comprobaciones

Al final del SQL: últimas re-ejecuciones, jobs de un solo uso pendientes y cómo probar una re-ejecución
desde el editor.
