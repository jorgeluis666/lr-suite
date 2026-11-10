# Verificación de coordinación ACRM

Desde este directorio: `npm ci`, y después `node database.mjs`, `node pacing.mjs`, `node embudo.mjs`, `node cotizaciones.mjs`, `node cotizaciones-ui.mjs`, `node leads.mjs`, `node ui.mjs` y `node pacing-ui.mjs`.

`cotizaciones-ui.mjs` prueba el puente de la pantalla de Cotizaciones (`acrm-cotizaciones.js`) contra las migraciones reales: que leer y volver a guardar no cambie nada, que «Perdido» detenga el seguimiento, que los toques vayan por su operación y en orden, que cotizar a un lead lo una a él, y que importar no borre lo que el archivo no trae.

`embudo.mjs` cubre la parte comercial: que la etapa la muevan los mensajes y no el teclado, que un entrante sin respuesta no cuente como contacto, que el embudo no retroceda, y las rachas y conversiones del marcador.

Las pruebas usan PostgreSQL embebido (PGlite) y DOM simulado; no requieren credenciales ni escriben en Supabase real. Comprueban permisos, estados, rechazos de versiones antiguas y de reservas duplicadas, y actualización de la interfaz ante eventos. PGlite usa una conexión: no sustituye una prueba de carga con varias conexiones reales.
