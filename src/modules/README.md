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
- `alertas-gasto`: módulo del `index.html` que compara el presupuesto asignado a cada cuenta de Google Ads y Meta Ads con lo que ya gastó. Sus datos viven en `lr_suite_private_data` (clave `gasto-alertas`); la carpeta `BBDD` guarda la lista de correos y el pg_cron del correo diario de las 8:30 a. m., que manda las mismas alertas que la campana de la barra superior.
- `control-automatizacion`: módulo del `index.html` que sigue el proceso de automatización común a todas las marcas (descarga desde Meta Ads y Google Ads, carpetas de Drive, carga automática o manual y módulos), con el estado real de cada pieza registrada en Supabase.
- `seguimiento-cotizaciones`: módulo comercial de cotizaciones, actualmente documentado para migración desde `index.html`.
- `lista-pendientes`: módulo operativo de tareas, actualmente documentado para migración desde `index.html`.
- `utm-builder`: generador de URLs con parámetros UTM.
- `clientes`: tablero de accesos a los dashboards de GitHub Pages y sus repositorios.
- `anuncios`: módulo del `index.html` con el rendimiento de cada anuncio de una marca al lado de su pieza de Drive (video, imagen o carrusel). Supabase suma el export de Meta Ads con la Google Visualization API y lo empareja con las piezas de Drive (sincronización diaria y botón "Actualizar").
- `prospeccion`: módulo del `index.html` con los perfiles de LinkedIn que se contactan: nombre, perfil, correo, web, empresa y cargo, en qué punto va el contacto y cuándo se le envió la información. Tabla propia en Supabase (`lr_suite_prospectos`), que se lee al abrir el módulo.
- `crm`: fase 1 del CRM, solo base de datos. Cruza leads de ManyChat, Prospección, la Agenda de WhatsApp y Cotizaciones en una ficha por persona, con un solo embudo y vistas de lectura en Supabase.
- `manychat`: módulo retirado de la navegación. Sus componentes se conservan aquí para reutilizarlos más adelante.
- `metricool-analysis`: módulo retirado de la navegación. Su código (datos, lector de PDF, render y estilos) se conserva aquí para reutilizarlo más adelante.

