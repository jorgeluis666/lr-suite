# Prueba del cambio de año

Ejecutar desde la raíz: `node tests/calendar/month-selectors.cjs`.
Para comprobar también la versión pública descargada: `node tests/calendar/month-selectors.cjs ruta/al/index.html`.

La prueba utiliza las funciones reales del HTML y los componentes/helpers de Next.js con reloj y datos simulados. No inicia sesión, no consulta Supabase y no guarda datos de usuarios.

Cubre diciembre de 2026, medianoche de Lima del 1 de enero de 2027, enero de 2027, navegación entre años, selección sin fecha, pendientes vencidos, importes guardados en varios años y el HTML renderizado de Cotizaciones. La versión pública estática ya contenía el arreglo del PR #46; la página Next.js de Cotizaciones necesitaba la corrección adicional.

El chequeo TypeScript general incluye funciones Deno de Supabase y falla por sus importaciones y globales ajenos a Next.js. Para comprobar la aplicación se excluyó `supabase/functions` en una configuración temporal, sin modificar la configuración del repositorio.
