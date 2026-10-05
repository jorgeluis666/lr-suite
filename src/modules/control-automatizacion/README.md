# Control de Automatización

Módulo del `index.html`. Sigue el proceso de automatización sobre el que corren (y correrán) los datos de
todas las marcas, tal como está dibujado en el proceso de la agencia:

```txt
Meta Ads ─┐
          ├─> Descarga automática ─> Carpetas en Google Drive ─> Carga de datos ─> Dashboard Lima Retail
Google Ads┘                                                      (automática y      (Objetivos / Ventas, Gasto
                                                                  botón manual)      publicitario, Proyecciones,
                                                                                     Palabras clave, Anuncios…)
```

Es observación: no cambia datos ni reimplementa ninguna sincronización. No mira los repositorios de cada
marca; sigue la infraestructura común.

## Archivos

- `BBDD/control-automatizacion.sql`: registro de piezas, corridas y RPC del módulo. Ejecutarlo completo en
  Supabase > SQL Editor (es idempotente y sirve aunque ya se haya instalado la versión 1).
- `BBDD/README.md`: tablas, RPC y cómo sumar una automatización nueva.
- La interfaz (`automationModule()` y funciones `automation*`) y sus estilos (`.automation-*`) viven en el
  `index.html`, como el resto de módulos.

## Qué muestra

- **Proceso**: las cinco etapas del gráfico, conectadas con flechas. Cada pieza muestra su estado; cada
  etapa toma el de su pieza más grave. Al elegir una pieza se abre su detalle.
- **Indicadores**: etapas al día, piezas activas y pendientes, errores de los últimos 7 días y el dato más
  antiguo que muestra el dashboard.
- **Detalle de la pieza**: últimas corridas (automáticas y manuales, con duración y error), ficha (job de
  pg_cron, último dato, filas o archivos) y errores recientes. Las cargas tienen el botón «Ejecutar ahora».
- **Ejecuciones**: todas las corridas del proceso, con filtro «Solo errores».
- **Cargas manuales**: quién, cuándo y qué se cargó («Ejecutar ahora» y el botón «Actualizar» de cada módulo).

## Piezas de hoy

| Etapa | Pieza | Estado |
| --- | --- | --- |
| Descarga automática | Descarga de Meta Ads · Descarga de Google Ads | Pendiente |
| Carpetas en Google Drive | Hoja «Perdidas y ganancias» · Carpeta de informes de Google Ads | Activa |
| Carga de datos | Carga de Pérdidas y Ganancias (pg_cron 06:00) · Carga de palabras clave (pg_cron 06:20) | Activa, con «Ejecutar ahora» |
| Dashboard | Palabras clave · Pérdidas y Ganancias | Activa |
| Dashboard | Objetivos / Ventas por cliente · Gasto publicitario · Proyecciones · Anuncios | Pendiente |

Las piezas viven en `lr_suite_automation_components`. Cuando se construya una automatización nueva (por
ejemplo, la descarga de Meta Ads de una marca), se registra ahí y aparece sola en el proceso: ver
`BBDD/README.md`.

## Reglas

- **Activa**: existe y se mide. **Pendiente**: todavía no existe. **Pausada**: existe pero está detenida.
- Estado de una pieza activa: **Error** si su última corrida falló o su job de pg_cron no existe o está
  desactivado; si no, la antigüedad de su último dato: verde hasta la mitad del umbral, ámbar hasta el
  umbral y rojo después. El umbral se elige en el módulo (24 h a 7 días; 48 h por defecto). Las piezas
  semanales suman 7 días y las mensuales 31 (la carpeta de informes de Google Ads es mensual).
- Las antigüedades se miden con el reloj de Supabase (`serverNow` del RPC) y las fechas se muestran en hora
  de Lima, así no dependen del reloj ni de la zona horaria del equipo.
- **Ejecutar ahora**: la corrida entra en cola (`run_lr_suite_automation`), pg_cron la ejecuta en el minuto
  siguiente y el módulo relee el estado cada 15 s hasta que termina.
- Sin el SQL instalado, el proceso se dibuja igual (con las piezas de hoy) y avisa que falta instalarlo.
- Egress: una lectura de ~6 KB al abrir el módulo, como máximo cada 2 minutos, y cada 15 s solo mientras
  hay una corrida en cola.
