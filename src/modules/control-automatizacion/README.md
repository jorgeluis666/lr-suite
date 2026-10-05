# Control de Automatización

Módulo del `index.html`. Muestra en un solo lugar el estado de todas las sincronizaciones automáticas, por
cliente y fuente: última corrida, estado, errores, frescura del dato y cargas manuales. Es observación: no
cambia datos ni reimplementa ninguna sincronización.

## Archivos

- `BBDD/control-automatizacion.sql`: tabla de re-ejecuciones y RPC del módulo. Ejecutarlo completo en
  Supabase > SQL Editor (es idempotente).
- `BBDD/README.md`: qué guarda la tabla y qué devuelven los RPC.
- La interfaz (`automationModule()` y funciones `automation*`) y sus estilos (`.automation-*`) viven en el
  `index.html`, como el resto de módulos. La lista de procesos vigilados es `AUTOMATION_PROCESSES`.

## Qué vigila

| Cliente | Proceso | Dónde corre | Frecuencia |
| --- | --- | --- | --- |
| Lima Retail | Pérdidas y Ganancias (Google Sheets) | Supabase · pg_cron `lr-suite-financial-daily` | Diario 6:00 a. m. |
| Lima Retail | Palabras clave de Google Ads (Drive) | Supabase · pg_cron `lr-suite-keywords-daily` | Diario 6:20 a. m. |
| Aquarius | Informes de Google Ads (Drive) | GitHub Actions `objetivos-Aquarius/sync-drive.yml` | Diario 6:20 a. m. |
| Casiopia | Ventas, Meta Ads y Google Ads (Drive) | GitHub Actions `objetivos-ventas-casiopia/sync-casiopia.yml` | Diario 7:00 a. m. |
| Casiopia | Ventas semanales (Sheets) | GitHub Actions `objetivos-ventas-casiopia/update-data.yml` | Lunes |
| Rekluta | Meta Ads y TikTok Ads (Drive) | GitHub Actions `objetivos-Rekluta/sync-ads-data.yml` | Diario 7:00 a. m. |
| Royal Baby | Ventas semanales (Sheets) | GitHub Actions `objetivo-ventas-RB/update-data.yml` | Lunes |

Las marcas del módulo Clientes sin proceso programado (hoy Amador, Excambiare, Terminal Pesquero y Tierra
Films) aparecen como «Sin sincronización automática». Para vigilar un proceso nuevo, sumarlo a
`AUTOMATION_PROCESSES`; si es de Supabase, también a `lr_suite_automation_jobs()` en el SQL.

## De dónde salen los datos

- **Supabase**: una lectura del RPC `lr_suite_automation_status` (~5 KB) al abrir el módulo, como máximo una
  vez cada 2 minutos. Las corridas automáticas salen de `cron.job_run_details` (historial de pg_cron) y el
  último dato de las filas `financial` y `keywords-status` de `lr_suite_private_data`, sin leer los CSV.
- **GitHub**: la API pública de GitHub, sin credenciales (los repositorios son públicos), una consulta por
  proceso cada 5 minutos como máximo. No pasa por Supabase. Sin cuenta, GitHub permite 60 consultas por hora
  y por conexión; si se agotan, el módulo lo avisa y muestra lo último que leyó.

## Reglas

- **Frescura**: antigüedad del último dato bueno. Verde hasta la mitad del umbral, ámbar hasta el umbral y
  rojo después. El umbral se elige en el módulo (24 a 96 h, 48 h por defecto) y a los procesos semanales se
  les suman 7 días. Un proceso de GitHub con corridas recientes y ninguna correcta sale en rojo.
- Las antigüedades se miden con el reloj de Supabase (`serverNow` del RPC) y las fechas se muestran en hora de
  Lima, así no dependen del reloj ni de la zona horaria del equipo.
- **Estado**: el de la corrida más reciente, automática o manual. Palabras clave sale «OK con avisos» si la
  última sincronización dejó informes sin descargar.
- **Re-ejecutar**: en Supabase la corrida entra en cola (`run_lr_suite_automation`) y pg_cron la ejecuta en el
  minuto siguiente; el módulo relee el estado cada 15 s hasta que termina. En GitHub el botón abre la página
  del flujo, donde se lanza con «Run workflow».
- **Cargas manuales**: re-ejecuciones pedidas desde el módulo, el botón «Actualizar» de Pérdidas y Ganancias
  (su fila guarda quién lo pulsó) y las corridas de GitHub lanzadas con «Run workflow».
- Sin el SQL instalado, el módulo muestra los procesos de GitHub y avisa que falta instalarlo.
