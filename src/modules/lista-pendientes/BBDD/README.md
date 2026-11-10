# BBDD - Lista de Pendientes

Esta carpeta concentra los datos y el modelo del modulo de pendientes.

## Quien puede entrar a LR Suite

La Suite es para dos personas fijas, y eso **no se configura desde la pantalla «Usuarios y
Claves»**: ahí solo se cambia la contraseña propia. Para dar o quitar acceso hay que tocar **tres
sitios, y los tres**:

1. **Supabase > Authentication**: crear o borrar la cuenta. Sin ella no hay login.
2. **`is_lr_suite_pending_user()`**, en `proyecto-nuevo-2026-09.sql` (seccion 1): la lista de
   correos que la RLS deja leer y escribir. Sin esto la persona entra y lo ve todo vacio.
3. **`DEFAULT_SUITE_USERS`**, en el `index.html`: el nombre que se muestra y el orden. Sin esto el
   login responde «Tu cuenta no tiene acceso a LR Suite».

Antes habia en esa pantalla un formulario «Agregar usuario» y unos permisos por modulo. No
servian: el usuario nuevo solo quedaba en el `localStorage` de ese navegador, y los permisos se
deshacian al recargar. Se quitaron en noviembre de 2026.

Y ojo con el historial: `mergeCompletedTaskHistory` descarta las tareas completadas por alguien
que no este en esa lista. Si se suma una tercera persona, hay que revisar tambien eso.

## Archivos

- `schema.sql`: tablas, politicas RLS y realtime para Supabase.
- `static-authenticated-state.sql`: snapshot compartido autenticado para que `index.html` mantenga la misma vista en GitHub Pages.
- `initial-data.json`: tareas iniciales del modulo.
- `schedule-jorge-luis-2026-06-15.sql`: migracion de fechas y horas para la semana del 15 al 19 de junio de 2026.
- `completed-history-archive.sql`: archivo append-only del historial y recuperacion del snapshot compartido.
- `pending-state-backups.sql`: snapshots append-only de pendientes activos, historial y tiempos.
- `pending-backup-trigger-and-view.sql`: trigger automatico y vista de un pendiente por fila.
- `resumen-persona-correo.sql`: los datos del resumen personal de la 1 y las 5 p. m.
- `resumen-persona-hora-exacta.sql`: pg_cron que lanza esos dos correos a la hora exacta.

## Tablas

- `lista_pendientes`: pendientes activos y siempre visibles.
- `lista_pendientes_completadas`: historial consolidado de tareas completadas o eliminadas.
- `lr_suite_pending_state`: estado compartido del HTML estatico, restringido a Jorge Luis y Diego mediante `auth.email()`.
- `lr_suite_pending_history`: copia independiente de cada tarea completada o eliminada.
- `lr_suite_pending_backups`: copias versionadas de toda la lista para validacion y recuperacion automatica.
- `lr_suite_pending_tasks_view`: vista legible de todos los pendientes activos, uno por fila.

## Fechas de tareas internas

Cada tarea interna (subtarea) guarda ahora `startDate` y `endDate` en formato `YYYY-MM-DD`.
Viven dentro del objeto de la subtarea, en la posicion 9 de cada pendiente, dentro de la columna
`tasks` (jsonb) de `lr_suite_pending_state`. **No requieren ALTER ni migracion**: son claves
nuevas de un documento JSON existente.

Las subtareas anteriores no tienen esas claves. `normalizePendingSubtask()` las completa con
cadena vacia al leerlas, que el tablero muestra como "sin fecha". Ningun dato previo se pierde ni
se reescribe.

El merge de sincronizacion conserva la fecha existente cuando la copia entrante llega vacia,
igual que `completedAt` y `completedBy`, para que un cliente desactualizado no borre fechas.

## Realtime

El componente usa:

- Supabase Realtime Postgres Changes para sincronizar pendientes e historial.
- Supabase Presence para mostrar usuarios conectados y que pendiente edita cada uno.
- `lr_suite_pending_state` para sincronizar el `index.html` estatico publicado en GitHub Pages.

## Regla de permanencia

Un pendiente solo sale de `lista_pendientes` cuando se marca como completado o se borra explicitamente. En ambos casos se inserta antes en `lista_pendientes_completadas`.

En el HTML estatico, cada cierre se guarda primero en `lr_suite_pending_state` y despues se archiva en
`lr_suite_pending_history`. El panel fusiona historiales recibidos y nunca reemplaza un historial existente
por una lista vacia.

Cada cambio de tareas crea ademas un backup local rotativo en el navegador. Cuando la tabla
`lr_suite_pending_backups` esta instalada, la aplicacion guarda una copia compartida despues de
sincronizar y valida los ultimos snapshots cada 30 segundos. Cada snapshot incluye pendientes,
historial y tiempos. Las tareas solo se excluyen de la recuperacion si tienen una marca explicita
de completado o eliminado.

El trigger de `pending-backup-trigger-and-view.sql` crea el backup directamente en Supabase cada
vez que cambia el estado compartido. Para revisar los pendientes sin abrir JSON, usar la vista
`lr_suite_pending_tasks_view`.

## El control de lo que cierra cada persona

El modulo lleva dos cuentas por persona, no una: los **pendientes** que cierra y las **tareas
internas** que marca. Son trabajos distintos —cerrar un pendiente es terminar un encargo, marcar una
tarea interna es avanzar dentro de uno—, y con una sola cifra el que parte todo en pasos parecia no
cerrar nada y el que no parte nada parecia cerrar el doble.

De donde sale cada cuenta:

- **Pendientes**: del historial (`lr_suite_pending_history`), que guarda quien lo cerro y cuando. Las
  eliminadas no cuentan: borrar algo no es haberlo hecho.
- **Tareas internas**: de las subtareas de los pendientes abiertos, que guardan `completedBy` y
  `completedAt`, mas `subtasksDoneByUser` de los pendientes ya cerrados. Ese campo nuevo del registro
  de cierre guarda **solo la cuenta**, por dia y por persona, igual que `dailySecondsByUser`: el
  registro del historial no se lleva las subtareas, y guardarlas enteras engordaria para siempre el
  estado compartido, que se baja completo en cada sincronizacion. Una subtarea sin fecha de cierre
  (las de antes de que se guardara quien y cuando) no cuenta para ningun dia en vez de caer toda
  sobre hoy.

Donde se ve: en la tarjeta de cada usuario del tablero («0 cerrados 3 tareas», al lado del tiempo
trabajado), en el contexto que recibe el agente IA —que lo usa para empujar, no para evaluar— y en
el correo de la 1 y las 5.

La cuenta esta escrita dos veces: `pendingScoreForUser()` en el `index.html` y `controlDe()` en
`scripts/correo/resumen-persona.mjs`. **Si cambia una, cambia la otra**, o el correo y el tablero
diran cifras distintas del mismo dia.

## El resumen personal de la 1 y las 5 p. m.

De lunes a viernes, a la 1 y a las 5 de la tarde de Lima, pg_cron le pide a GitHub que corra
`.github/workflows/resumen-persona.yml`, que corre `scripts/correo/resumen-persona.mjs`. No es un
correo para todos: es **uno por persona**, con sus cifras y nada mas.

Cada correo lleva, con la estetica de la Suite: el titular del dia (lo que cerro), las cuatro
tarjetas de hoy —cerrados, tareas, trabajado y abiertos—, su control del mes, la lista de lo que le
queda abierto con los dias de cada pendiente, y una tabla corta de como va el equipo hoy. El de la 1
se presenta como «Medio dia» y el de las 5 como «Cierre del dia»; el script lo decide por la hora de
Lima, asi que una corrida retrasada no llega con el rotulo equivocado.

- **A quien le llega**: a las cuentas de la Suite, leidas de `auth.users`. No hay lista de correos
  que mantener: el resumen es personal, asi que los destinatarios son exactamente los usuarios del
  panel. Si un correo rebota, los demas se envian igual.
- **Datos**: `public.lr_suite_resumen_persona(clave)` devuelve los pendientes activos, lo cerrado en
  el mes (recortado a lo que el correo necesita) y los tiempos del mes. La cuenta la hace el script.
- **Clave**: la fila `pendientes-persona` de `lr_suite_notificaciones_claves`, que no se lee por la
  API. El workflow la recibe por el secret `LR_PERSONA_CLAVE`.
- **Puesta en marcha**: ejecutar `resumen-persona-correo.sql` en el SQL Editor (al final muestra la
  clave), crear en GitHub el secret `LR_PERSONA_CLAVE` —los de SMTP ya estan, son los del correo de
  gasto— y despues `resumen-persona-hora-exacta.sql`, que reusa la llave de GitHub ya guardada
  (`github-actions`).
- **Probar**: `Actions -> Resumen personal de pendientes -> Run workflow`; con «Simulacion» marcada
  arma los correos sin enviarlos. En local, `node scripts/correo/resumen-persona.mjs --datos
  datos.json --preview correo.html` escribe el primero con datos de un archivo.
- **Si deja de salir**: la pieza `correo-pendientes` del Control de Automatizacion lo dice. Al terminar,
  el script anota ahi su corrida con `lr_suite_correo_anotar()`, asi que una corrida de pg_cron correcta
  sin la del script significa que se cayo el workflow, y una del script con error significa que fallo el
  envio. Ver `src/modules/control-automatizacion/BBDD/correos-automatizacion.sql`.

## El correo de las 8:30 ya no es de pendientes

Hasta octubre de 2026, el correo diario de las 8:30 a. m. era el resumen de los pendientes abiertos y
vivia en esta carpeta. Desde noviembre de 2026 ese correo lleva las alertas de gasto, las mismas que
da la campana de la Suite, y todo lo suyo —script, workflow, SQL y la lista de correos— esta en
`src/modules/alertas-gasto/BBDD/`. La tabla `lr_suite_notificaciones` sigue siendo la misma, con la
fila renombrada de `resumen-pendientes` a `alertas-gasto`.

