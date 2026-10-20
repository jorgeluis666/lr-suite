# BBDD · prospeccion

## Tabla

`public.lr_suite_prospectos`: un registro por perfil de LinkedIn contactado.
Columnas, estados y permisos están en `prospeccion.sql`, que es idempotente y se
ejecuta completo en Supabase > SQL Editor.

## Instalación

1. Ejecutar `src/modules/lista-pendientes/BBDD/security-hardening-2026-09.sql`
   si todavía no existe `public.is_lr_suite_pending_user()`. Sin esa función el
   script de prospección se detiene a propósito, para no dejar la tabla abierta.
   Ojo: el SQL Editor corre todo en una transacción, así que si se detiene ahí
   **no queda nada creado**, ni siquiera la tabla.
2. Ejecutar `prospeccion.sql` completo.
3. Mirar lo que devuelve al final: `tabla_creada = lr_suite_prospectos` y
   `politicas = 4`. Si sale vacío, no se creó.

El script termina con `notify pgrst, 'reload schema'` porque la API sirve un
esquema cacheado: sin ese aviso, la tabla recién creada puede responder
`PGRST205 · Could not find the table` y el módulo diría que no existe.

## Permisos

- `anon` no tiene nada.
- `authenticated` pasa por RLS: lee, inserta, actualiza y borra solo si
  `public.is_lr_suite_pending_user()`, la misma puerta del resto de la Suite
  (las dos cuentas de la agencia).
- No hay Edge Function ni `service_role` en este módulo: escribe el navegador
  con la sesión de la persona.

## Decisiones

- **Tabla propia, no una fila de `lr_suite_private_data`.** Cada cambio toca un
  solo perfil; escribir la lista entera en cada edición haría que las dos
  cuentas se pisaran y crecería el payload sin necesidad.
- **Índice único parcial sobre `lower(linkedin_url)`.** Un perfil, un registro:
  es lo que evita contactar dos veces a la misma persona. Es parcial para no
  bloquear el contacto que llegó por otro lado y no tiene URL.
- **Las fechas de los hitos son columnas, no un historial.** Interesa cuándo se
  envió la invitación y cuándo la información; un log de cada cambio de estado
  no se usaría y pesaría más.
