# LR Suite

LR Suite es una aplicación operativa para gestión financiera, comercial y de performance. El proyecto combina una app Next.js con Supabase y un `index.html` estático de acceso rápido.

## Estructura Principal

```txt
src/
  app/
    layout.tsx
    page.tsx
    globals.css
  lib/
    supabase.ts
  modules/
    control-roas/
      BBDD/
      types.ts
      utils.ts
    estado-perdidas-ganancias/
      BBDD/
    seguimiento-cotizaciones/
      BBDD/
    lista-pendientes/
      BBDD/
```

## Módulos

### `control-roas`

Módulo activo de la app Next.js. Gestiona registros ROAS, costos, empresas, workspaces, miembros del equipo, filtros y reportes.

### `estado-perdidas-ganancias`

Módulo financiero del `index.html`. Lee la hoja de Google "Perdidas y ganancias - Lima Retail" a través de Supabase: actualización automática diaria (pg_cron, 06:00 Lima) y botón "Actualizar". Ver `src/modules/estado-perdidas-ganancias/BBDD/README.md`.

### `analisis-palabras-clave`

Módulo de marketing del `index.html`. Muestra las palabras clave de Google Ads por campaña y mes, leídas de los informes mensuales de una carpeta de Google Drive: actualización automática diaria (pg_cron, 06:20 Lima), botón "Actualizar" que lee las hojas desde el navegador y exclusión de campañas (la del hackeo de la cuenta). Ver `src/modules/analisis-palabras-clave/README.md`.

### `control-automatizacion`

Módulo del `index.html`. Sigue el proceso de automatización sobre el que corren los datos de todas las marcas: Meta Ads y Google Ads, descarga automática, carpetas de Google Drive, carga de datos (automática o con el botón manual) y módulos del dashboard. Cada pieza está registrada en Supabase y muestra su estado real (corridas, errores, frescura con semáforo) o "Pendiente" si todavía no existe. Debajo del proceso, y aparte de él porque no recibe datos del dashboard, va la etapa "Asistente de la Agenda" con sus tres piezas (webhook de WhatsApp, asistente y reuniones en Google Calendar). Ver `src/modules/control-automatizacion/README.md`.

### `seguimiento-cotizaciones`

Módulo comercial para controlar cotizaciones por cliente, estado, monto, probabilidad, responsable y próximo seguimiento.

### `lista-pendientes`

Módulo operativo para seguimiento de tareas, prioridades, responsables, vencimientos y estados.

### `utm-builder`

Generador de URLs con parámetros UTM para campañas.

### `clientes`

Tablero de accesos. Reúne todos los proyectos de GitHub del equipo con su enlace al dashboard publicado en GitHub Pages y a su repositorio, agrupados por cliente. El catálogo vive en `src/modules/clientes/data.ts`.

### `agenda`

Módulo del `index.html`. Un asistente atiende el WhatsApp de la agencia: asesora con el conocimiento
cargado, ofrece huecos reales (horario de atención menos lo ocupado en Google Calendar) y cierra la
cita creando la reunión con invitación y Meet. Ninguna respuesta se envía sin pasar los estándares que
la agencia escribe en el panel. El webhook y las acciones del panel corren en Edge Functions
(`supabase/functions/whatsapp` y `supabase/functions/agenda-panel`). Sus tres piezas —webhook de
WhatsApp, asistente y reuniones en Google Calendar— también se ven en la vista "Automatización" de
Clientes, en una etapa aparte del camino de los datos de las marcas. Ver `src/modules/agenda/README.md`.

### `prospeccion`

Módulo del `index.html`. El control de la prospección en LinkedIn: un registro por perfil al que se
escribe, con nombre, apellido, URL del perfil, correo, web, empresa y cargo, en qué punto va el
contacto y las fechas de los tres hitos (invitación enviada, información enviada, respondió). Los
perfiles se agregan uno a uno o pegando una lista desde una hoja de cálculo —el nombre y el apellido
se proponen desde el enlace, editables—, y la URL del perfil no puede repetirse, para no contactar
dos veces a la misma persona. Vive en su propia tabla de Supabase
(`lr_suite_prospectos`), que se lee al abrir el módulo. Ver `src/modules/prospeccion/README.md`.

### `manychat`

Módulo retirado de la navegación. Sus componentes se conservan en `src/modules/manychat` para retomarlos en el futuro; ya no existe la ruta `/manychat`.

## Carpeta `BBDD`

Cada módulo tiene su propia carpeta `BBDD`. Su finalidad es centralizar:

- Esquemas de tablas.
- Diccionarios de campos.
- SQL o migraciones.
- Datos demo.
- Notas de Supabase.
- Decisiones de modelo de datos.

Esto evita que la información generada por cada módulo quede dispersa o se pierda.

## Archivos Importantes

- `src/app/page.tsx`: pantalla principal actual. Sigue concentrando la UI del módulo `control-roas`, pero ahora consume tipos y utilidades desde `src/modules/control-roas`.
- `src/lib/supabase.ts`: cliente compartido de Supabase.
- `src/modules/control-roas/types.ts`: tipos principales del módulo activo.
- `src/modules/control-roas/utils.ts`: helpers de fechas, moneda, ROAS y errores Supabase.
- `index.html`: versión estática autónoma de LR Suite para abrir en navegador sin servidor local.

## Limpieza Realizada

- Se centralizó el cliente Supabase fuera de `src/app`.
- Se separaron tipos y utilidades repetibles del módulo ROAS.
- Se creó `src/modules` con carpeta `BBDD` por módulo.
- Se eliminaron assets SVG de plantilla de Next que no estaban siendo usados.
- Se documentó la estructura modular esperada.

## Comandos

```bash
npm run dev
npm run build
npm run lint
```

