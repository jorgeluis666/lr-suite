# Módulos

Cada carpeta dentro de `src/modules` representa un módulo funcional independiente.

## Reglas

- Los archivos de un módulo deben vivir dentro de su carpeta.
- Cada módulo debe incluir una carpeta `BBDD`.
- `BBDD` documenta tablas, esquemas, datos demo, migraciones y decisiones de base de datos del módulo.
- La lógica compartida entre módulos debe vivir en `src/lib` o en componentes compartidos, no duplicada dentro de cada módulo.

## Módulos actuales

- `control-roas`: módulo activo de dashboard ROAS, costos, empresas, workspaces y equipo.
- `estado-perdidas-ganancias`: módulo financiero del `index.html`, conectado a Google Sheets mediante Supabase (sincronización diaria y manual).
- `analisis-palabras-clave`: módulo del `index.html` con las palabras clave de Google Ads por campaña, leídas de una carpeta de Google Drive (sincronización diaria en Supabase y botón "Actualizar" desde el navegador). Su lector `keyword-report.js` lo comparten el `index.html` y el script de Node.
- `alertas-gasto`: módulo del `index.html` que compara el presupuesto asignado a cada cuenta de Google Ads y Meta Ads con lo que ya gastó. Sus datos viven en `lr_suite_private_data` (clave `gasto-alertas`); la carpeta `BBDD` guarda la lista de correos y el pg_cron del correo diario de las 8:30 a. m., que manda las mismas alertas que la campana de la barra superior. Debajo del pacing por marca, un desplegable («Pacing de gasto por canal y día») dibuja cada plataforma contra su línea ideal a lo largo de los días del mes: la curva hasta el día del informe es el acumulado real repartido al ritmo medio —el informe no trae el gasto de cada día— y la punteada, dónde cierra el mes si sigue así.
- `control-automatizacion`: módulo del `index.html` que sigue el proceso de automatización común a todas las marcas (descarga desde Meta Ads y Google Ads, carpetas de Drive, carga automática o manual y módulos), con el estado real de cada pieza registrada en Supabase.
- `seguimiento-cotizaciones`: absorbido por el ACRM. Su pantalla es la sección «Cotizaciones» del ACRM y sus datos, `lr_acrm_cotizaciones` (ver `prospeccion/ACRM-CONTACTABILIDAD.md`).
- `lista-pendientes`: módulo operativo de tareas, actualmente documentado para migración desde `index.html`.
- `utm-builder`: generador de URLs con parámetros UTM.
- `clientes`: tablero de accesos a los dashboards de GitHub Pages y sus repositorios.
- `anuncios`: módulo del `index.html` con el rendimiento de cada anuncio de una marca al lado de su pieza de Drive (video, imagen o carrusel). Supabase suma el export de Meta Ads con la Google Visualization API y lo empareja con las piezas de Drive (sincronización diaria y botón "Actualizar").
- `agentes-ia`: tablero de los agentes de la casa. Lista cuáles existen, deja cargarle a cada uno prompts, documentos y enlaces que su Edge Function lee en cada llamada, y mide lo que gasta en tokens y API (ver `agentes-ia/README.md`).
- `prospeccion`: el ACRM, de la captura a la venta: cola de acciones, embudo, lista compartida de LinkedIn y cotizaciones (ver `prospeccion/README.md`).
- `manychat`: módulo retirado de la navegación. Sus componentes se conservan aquí para reutilizarlos más adelante.
- `metricool-analysis`: módulo retirado de la navegación. Su código (datos, lector de PDF, render y estilos) se conserva aquí para reutilizarlo más adelante.

