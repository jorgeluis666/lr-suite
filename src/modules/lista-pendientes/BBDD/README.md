# BBDD - Lista de Pendientes

Esta carpeta concentra los datos y el modelo del modulo de pendientes.

## Archivos

- `schema.sql`: tablas, politicas RLS y realtime para Supabase.
- `static-authenticated-state.sql`: snapshot compartido autenticado para que `index.html` mantenga la misma vista en GitHub Pages.
- `initial-data.json`: tareas iniciales del modulo.

## Tablas

- `lista_pendientes`: pendientes activos y siempre visibles.
- `lista_pendientes_completadas`: historial consolidado de tareas completadas o eliminadas.
- `lr_suite_pending_state`: estado compartido del HTML estatico, restringido a Jorge Luis y Diego mediante `auth.email()`.

## Realtime

El componente usa:

- Supabase Realtime Postgres Changes para sincronizar pendientes e historial.
- Supabase Presence para mostrar usuarios conectados y que pendiente edita cada uno.
- `lr_suite_pending_state` para sincronizar el `index.html` estatico publicado en GitHub Pages.

## Regla de permanencia

Un pendiente solo sale de `lista_pendientes` cuando se marca como completado o se borra explicitamente. En ambos casos se inserta antes en `lista_pendientes_completadas`.
