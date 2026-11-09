# Verificación de coordinación ACRM

Desde este directorio: `npm ci`, `node database.mjs` y `node ui.mjs`.

Las pruebas usan PostgreSQL embebido (PGlite) y DOM simulado; no requieren credenciales ni escriben en Supabase real. Comprueban permisos, estados, rechazos de versiones antiguas y de reservas duplicadas, y actualización de la interfaz ante eventos. PGlite usa una conexión: no sustituye una prueba de carga con varias conexiones reales.
