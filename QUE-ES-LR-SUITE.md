# ¿Qué es LR Suite?

**LR Suite** es la aplicación interna de operaciones de **Lima Retail**: un único tablero web donde
el equipo de la agencia trabaja el día a día —pendientes, prospectos, citas, campañas y finanzas— sin
abrir una hoja de cálculo ni entrar a cada plataforma de publicidad.

- **Dónde vive:** <https://suite.limaretail.com> (GitHub Pages, dominio propio).
- **Para quién:** dos cuentas fijas del equipo (Jorge Luis y Diego). No es un producto para clientes:
  los clientes ven sus propios tableros de marca, que son repositorios aparte y se enlazan desde aquí.
- **Qué la mueve:** Supabase (base de datos, Auth, pg_cron y Edge Functions), Google Drive/Sheets como
  origen de informes, las APIs de Meta Ads y Google Ads a través de **Nexus**, WhatsApp Cloud API,
  Google Calendar y la API de Claude para los agentes.

---

## Objetivo

Que **todo lo que la agencia necesita decidir en el día esté en una sola pantalla, con el dato ya
cargado y verificado**, en lugar de repartido entre plataformas, hojas de Drive y correos.

De ahí salen los tres compromisos del proyecto:

1. **Un solo sitio.** Finanzas, comercial y performance conviven en el mismo panel modular, con la
   misma sesión y el mismo lenguaje visual.
2. **El dato llega solo.** Nada se sube a mano: los informes los trae la automatización (Nexus hacia
   Drive y Supabase; pg_cron hacia los módulos) y cada pieza del camino muestra su estado real.
3. **La IA propone, la persona decide.** Los agentes priorizan, redactan y resumen, pero cada cambio
   se confirma; nada se mueve sin un «Hazlo».

Dos restricciones de diseño que explican buena parte de las decisiones técnicas:

- **Supabase en plan gratuito.** Las lecturas se calculan en Postgres y bajan resúmenes, no tablas.
- **El repositorio es público.** Ningún dato de negocio, ID de Drive, correo de cliente ni secreto
  vive en el código: todo eso está en Supabase o en los secretos de GitHub Actions.

---

## Arquitectura en una pantalla

```txt
Meta Ads API ─┐
Google Ads API├─► Nexus (app PHP aparte) ─► Google Drive / Sheets ─┐
              │                                                    ├─► Supabase ─► LR Suite
WhatsApp ─────┴─► Edge Function «whatsapp» ─► Google Calendar      │   (pg_cron,   (index.html
                                                                   │    RLS, RPC)   en Pages)
Hojas de la agencia (P&G, reglas, palabras clave) ─────────────────┘
                                                                        │
                        GitHub Actions + pg_cron ─► correo del equipo ◄──┘
```

- **Frontend:** un único `index.html` estático (sin build, sin servidor) más los módulos de
  `src/modules/` que carga como scripts. La versión Next.js del inicio quedó retirada.
- **Backend:** Supabase. Las tablas tienen RLS contra la lista de correos autorizados; las lecturas
  pesadas pasan por RPC; los trabajos periódicos, por `pg_cron`.
- **Lógica con llave:** Edge Functions (`supabase/functions/`) para todo lo que no puede vivir en el
  navegador: la API de Claude, el acceso a Google Calendar, el webhook de WhatsApp.
- **Automatización de correo y despliegue:** workflows en `.github/workflows/` (publicar, desplegar
  funciones, alertas de gasto, resúmenes personales, ACRM, calendarios, recuperación de contraseñas).

---

## Funcionalidades actuales

Los once módulos de la barra lateral, en el orden en que aparecen.

### 1. Pendientes

Control operativo de tareas por prioridad, responsable, vencimiento y estado, sobre estado compartido
en tiempo real.

- Pendientes partidos en **tareas internas** con sus fechas, y **cronómetro** de tiempo trabajado.
- **Control de cierre por persona:** cuántos pendientes y tareas internas cerró cada uno, hoy y en el
  mes, visible en su tarjeta.
- **Resumen personal por correo** a la 1 y a las 5 p. m. con lo abierto y lo vencido de cada uno.
- **Agente IA** (`pendientes-agente`): entra con la foto del tablero, propone el orden para cerrar,
  parte pendientes, lleva el cronómetro y agenda reuniones en Google Calendar. Cada cambio se ofrece
  como acción con «Hazlo» / «Ahora no».
- Historial consolidado y copias versionadas de la lista para recuperación.

### 2. ACRM (prospección)

Lleva un prospecto **de la captura a la venta** en una sola página: tabla maestra de leads con la
ficha de cada uno.

- **Acciones:** cola de próximas acciones priorizada por IA, embudo y metas por canal, marcador de
  quién va ganando.
- **Lista compartida de LinkedIn** con reserva del contacto antes del primer mensaje, para que dos
  personas no escriban al mismo perfil.
- **Cotizaciones:** las propuestas y sus ocho contactos de seguimiento (antes era un módulo aparte;
  hoy es una sección del ACRM).
- **Prospección por lotes** y descubrimiento de perfiles (`lr-pros-descubrir`).
- Tres agentes: la cola (`acrm-agente`), la ficha del lead (`acrm-ficha`) y el botón «Prioridad IA»
  (`acrm-priorizar`).

### 3. Agenda

Un asistente atiende el **WhatsApp de la agencia** de punta a punta.

- Asesora con el conocimiento cargado por el equipo (servicios, precios, horarios), **sin inventar**.
- Ofrece **huecos reales**: horario de atención menos citas y menos lo ocupado en Google Calendar.
- **Cierra la cita** creando el evento con invitación y Meet.
- Ninguna respuesta sale sin pasar el **filtro de estándares** que la agencia escribe en el panel; si
  no sabe o el filtro frena, marca la conversación para que la tome una persona.
- No reprograma, no cancela y no manda recordatorios: deja la solicitud al equipo.

### 4. Clientes

Dos vistas:

- **Conexiones:** tablero de accesos con todos los proyectos del equipo, su dashboard publicado en
  GitHub Pages y su repositorio, agrupados por cliente.
- **Automatización:** el camino completo del dato de cada marca (plataformas → descarga → carpetas de
  Drive → carga → módulo del dashboard), pieza por pieza, con su estado real —corridas, errores y
  frescura con semáforo— o «Pendiente» si todavía no existe. Aparte van las etapas que no alimentan
  módulos: el asistente de la Agenda y los correos que la Suite manda sola.

### 5. Alertas de Gasto

Pacing presupuestario por marca: lo asignado en cada cuenta de Google Ads y Meta Ads frente a lo que
ya se gastó.

- **Pacing por marca** y desplegable de **gasto por canal y día**, con la curva real frente a la línea
  ideal y la proyección de cierre de mes.
- **Campana** en la barra superior con lo que no va en ritmo, y las mismas alertas **por correo todos
  los días a las 8:30 a. m.**, con los destinatarios editables desde el panel.
- Las sugerencias siguen el **Ciclo Mensual de Análisis y Optimización** (`src/modules/reglas`):
  cuatro hitos por semana del mes declarados en una hoja por marca, no umbrales escritos en el código.
- Carga del gasto vía Nexus desde las APIs de las dos plataformas.
- Agente propio (`gasto-agente`) y análisis de reglas (`reglas-analisis`).

### 6. Análisis de Palabras Clave

Comportamiento de las palabras clave de Google Ads **por campaña, mes a mes**, leído de los informes
mensuales guardados en una carpeta de Drive. Sincronización diaria con pg_cron (06:20 Lima), botón
«Actualizar» y exclusión de campañas.

### 7. Anuncios

Rendimiento de cada anuncio **al lado de su pieza creativa**: el video, la imagen o el carrusel que
está en la carpeta de artes de la marca en Drive. Suma las filas por nombre de anuncio, empareja ese
nombre con el archivo o la subcarpeta `(Carrusel)`, admite equivalencias por marca para nombres
abreviados, y mezcla las dos formas de la hoja del mes (la descarga de Meta y la pestaña que escribe
Nexus) sin duplicar días.

### 8. Pérdidas y Ganancias

Lectura financiera mensual con márgenes y resultado neto, desde la hoja de Google «Perdidas y
ganancias - Lima Retail» (pestañas Ventas, Inversión y Venta vs Resultados). Actualización automática
diaria a las 06:00 de Lima y botón «Actualizar».

### 9. UTM Builder

Generador de URLs estandarizadas con parámetros UTM para GA4.

### 10. Agentes IA

El tablero de los agentes de la casa, con dos mitades:

- **El recibo:** cada llamada a Anthropic queda anotada con su costo congelado al precio del momento.
  El tablero muestra por agente la rayita de gasto día a día, sus cifras y sus alertas («Apagado»,
  «Modelo cambiado», «Gasto al alza», «Material pesado», «Sin uso»…). El desglose por agente, por
  persona y por día que la consola de Anthropic no da.
- **El material:** desde la ficha se le carga a cada agente su **marco de indicadores**, prompts,
  documentos y enlaces, que su Edge Function lee en cada llamada y añade al final de su prompt de
  sistema. Las herramientas y los límites siguen en TypeScript: eso no se puede cambiar desde el
  navegador.

Siete agentes en el catálogo: `pendientes`, `gasto`, `prospeccion`, `ficha`, `priorizar`, `whatsapp`
y `reglas`.

### 11. Usuarios y Claves

Gestión del acceso propio y **recuperación de contraseña** por Supabase Auth: enlace temporal de un
solo uso, clave nueva de al menos 12 caracteres, cierre global de sesiones y respuesta genérica ante
correos inexistentes. El alta y la baja de una persona no se hacen desde la pantalla: exigen tocar
Supabase Auth, la función `is_lr_suite_pending_user()` y la lista de usuarios del `index.html`.

---

## Lo que la Suite **no** hace

- No sustituye a las plataformas: no crea ni edita campañas en Meta Ads ni Google Ads.
- No descarga ni sube informes a mano; si falta un dato en Drive, se arregla en **Nexus**.
- No guarda datos de negocio en el repositorio, que es público.
- No tiene altas de usuario desde la interfaz ni permisos por módulo: las dos cuentas lo ven todo.
- No lee PDF ni Word para el material de los agentes: solo texto plano.

---

## Mapa del repositorio

| Ruta | Qué es |
| --- | --- |
| `index.html` | La aplicación entera: pantallas, estilos y lógica de los módulos. |
| `src/modules/<módulo>/` | Scripts, documentación y carpeta `BBDD` (esquemas, RPC, migraciones y decisiones) de cada módulo. |
| `supabase/functions/` | Edge Functions: agentes, webhook de WhatsApp, panel de la Agenda. |
| `supabase/migrations/` | Migraciones del proyecto, aplicadas a mano desde el editor SQL del panel. |
| `.github/workflows/` | Publicación, despliegue de funciones y los correos automáticos. |
| `assets/` | Logo y fondo del acceso. |
| `privacidad.html`, `recuperar.html` | Política de privacidad y pantalla de nueva contraseña. |
| `tests/`, `scripts/` | Pruebas con `node --test` y comprobaciones del `index.html`. |
| `private/` | Notas y SQL con datos reales; fuera del repositorio público. |

---

_Documento de referencia, al 13 de noviembre de 2026._
