# BBDD · prospeccion

## `prospeccion-hoja-sincronizar.sql` — la hoja de prospección entra sola

Vigente. Descarga la pestaña Contactos de la hoja «Prospección comercial – Lima Retail» desde la
propia base (extensión `http`), compara su md5 con el de la última vez y, si cambió, da de alta las
filas como leads de origen «Ads Library» con `private.lr_acrm_prospecto_hoja` (migración
`20261123090000_acrm_hoja_texto.sql`, que es donde está el parseo y lo que las pruebas cubren).
`pg_cron` lo corre cada día a las 12:30 de Lima; el botón «Sincronizar ahora» del panel llama a la
misma función. El identificador de la hoja vive en la fila `prospeccion-hoja` de
`lr_suite_private_data`, no en el repositorio. Requiere la hoja compartida como «Cualquier persona
con el enlace: Lector» y su columna «URL del perfil». Detalle y requisitos, en la cabecera del
archivo.

## El resto de este directorio

> **Retirada de la interfaz (noviembre de 2026).** Ninguna pantalla lee ni escribe ya
> `lr_suite_prospectos`: la reemplazó el ACRM (`../ACRM-CONTACTABILIDAD.md`). La tabla y sus datos
> siguen en Supabase. Lo de abajo queda como registro de cómo se instaló.

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
