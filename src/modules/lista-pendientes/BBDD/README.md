# BBDD - Lista de Pendientes

Esta carpeta concentra los datos y el modelo del módulo de pendientes.

## Archivos

- `schema.sql`: tablas, políticas RLS y realtime para Supabase.
- `initial-data.json`: tareas iniciales del módulo.

## Tablas

- `lista_pendientes`: pendientes activos y siempre visibles.
- `lista_pendientes_completadas`: historial consolidado de tareas completadas o eliminadas.

## Realtime

El componente usa:

- Supabase Realtime Postgres Changes para sincronizar pendientes e historial.
- Supabase Presence para mostrar usuarios conectados y qué pendiente edita cada uno.

## Regla de permanencia

Un pendiente solo sale de `lista_pendientes` cuando se marca como completado o se borra explícitamente. En ambos casos se inserta antes en `lista_pendientes_completadas`.
