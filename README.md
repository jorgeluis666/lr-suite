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

Ya no es un módulo del menú: es la sección **Cotizaciones** del ACRM (`prospeccion`). Los datos viven en `lr_acrm_cotizaciones` y la pantalla los lee y escribe por `src/modules/prospeccion/acrm-cotizaciones.js`. Ver `src/modules/prospeccion/ACRM-CONTACTABILIDAD.md`.

### `lista-pendientes`

Módulo operativo para seguimiento de tareas, prioridades, responsables, vencimientos y estados. Ver `src/modules/lista-pendientes/BBDD/README.md`.

Lleva un **Agente IA** (botón en la cabecera del módulo): un chat lateral que al abrirse entra con la
foto del tablero —cuántos pendientes hay, cuáles están vencidos o trabados, cuánto se lleva trabajado
hoy— y propone el orden para cerrarlos cuanto antes. Parte pendientes en tareas internas, lleva el
cronómetro y agenda reuniones en Google Calendar.

También lleva el **control de lo que cierra cada persona**: cuántos pendientes cerró y cuántas tareas
internas marcó, hoy y en lo que va del mes. Se ve en la tarjeta de cada usuario, al lado del tiempo
trabajado, el agente lo recibe con el tablero, y a la 1 y a las 5 de la tarde cada uno recibe el suyo
por correo, con lo que le queda abierto y lo que tiene vencido. Ver
`src/modules/lista-pendientes/BBDD/README.md`.

Propone cada cambio como una acción con "Hazlo" / "Ahora no": nada se mueve sin confirmación. Las
acciones del tablero las ejecuta el navegador sobre el mismo estado compartido que el tablero; las de
Google Calendar las ejecuta la Edge Function, que es donde vive el acceso a Google. Consultar los
huecos libres (`ver_agenda`) no cambia nada, así que se resuelve solo.

El modelo se consulta en la Edge Function `supabase/functions/pendientes-agente`, que exige la sesión
de la Suite y guarda como secretos la clave de Anthropic (`ANTHROPIC_API_KEY`) y el acceso a Google
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`, los mismos
que usa la Agenda). Sin los de Google el chat funciona igual y solo avisa que falta configurarlos. Se
despliega desde GitHub con el workflow `.github/workflows/desplegar-funciones.yml` (el equipo de la
agencia no puede: algo intercepta el TLS y la CLI no llega a `api.supabase.com`); el modelo, el
esfuerzo y la jornada se
cambian sin tocar el código con `supabase secrets set PENDIENTES_MODELO=... PENDIENTES_ESFUERZO=...
JORNADA_INICIO=9 JORNADA_FIN=18`. La conversación vive solo mientras la pestaña esté abierta: no se
guarda en el navegador ni en Supabase.

### `alertas-gasto`

Módulo del `index.html`. Compara el presupuesto asignado a cada cuenta de Google Ads y Meta Ads con lo que ya gastó, y lo resume en el pacing de cada marca. La campana de la barra superior avisa de lo que no va en ritmo y, todos los días a las 8:30 a. m., esas mismas alertas llegan por correo; los correos que las reciben se cambian con la ruedita del panel de Notificaciones. Ver `src/modules/alertas-gasto/BBDD/README.md`.

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

El ACRM, módulo del `index.html`: lleva al prospecto de la captura a la venta. Sección «Acciones»
(cola priorizada por IA, embudo y metas por canal, lista compartida de LinkedIn con reserva) y sección
«Cotizaciones» (propuestas y sus ocho contactos de seguimiento, sobre `lr_acrm_cotizaciones`). Ver
`src/modules/prospeccion/README.md`.

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

