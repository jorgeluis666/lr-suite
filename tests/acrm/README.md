# Verificación de coordinación ACRM

Desde este directorio: `npm ci`, y después `node database.mjs`, `node pacing.mjs`, `node embudo.mjs`, `node ui.mjs` y `node pacing-ui.mjs`.

`embudo.mjs` cubre la parte comercial: que la etapa la muevan los mensajes y no el teclado, que un entrante sin respuesta no cuente como contacto, que el embudo no retroceda, y las rachas y conversiones del marcador.

Las pruebas usan PostgreSQL embebido (PGlite) y DOM simulado; no requieren credenciales ni escriben en Supabase real. Comprueban permisos, estados, rechazos de versiones antiguas y de reservas duplicadas, y actualización de la interfaz ante eventos. PGlite usa una conexión: no sustituye una prueba de carga con varias conexiones reales.
