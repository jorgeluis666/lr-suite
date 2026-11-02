# BBDD - Alertas de Gasto

Esta carpeta concentra lo que el modulo de Alertas de Gasto necesita en Supabase.

## Archivos

- `alertas-gasto-correo.sql`: correos de las alertas diarias y la funcion que entrega el informe.
- `alertas-gasto-hora-exacta.sql`: pg_cron que lanza el correo a las 8:30 a. m. exactas.

## Datos

El modulo no tiene tabla propia: su payload vive en `lr_suite_private_data`, clave `gasto-alertas`,
porque este repositorio es publico y los nombres de las cuentas, sus ids y lo que gasta cada marca
no pueden estar aqui.

```
{ informes: { "2026-10": { plataforma, desde, hasta, subidoAt, cuentas: [...] } },
  cuentas:  { "<id de cuenta>": { marca, presupuestos: { "2026-10": 1200 } } } }
```

El modulo abre en el ultimo mes **con informe**, y el selector de la barra deja elegir otro: un mes
cerrado para revisar o corregir su presupuesto, o uno que todavia no tiene informe para dejarlo
cargado antes de que empiece el gasto. La lista son los meses con informe, los que ya tienen algun
presupuesto escrito, el mes en curso y el siguiente.

Un mes sin informe solo muestra el formulario de presupuestos, con lo asignado el mes anterior al
lado para comparar: sin gasto no hay ritmo, proyeccion ni consumido que calcular, y dibujar esas
columnas vacias se leeria como que la cuenta no gasto nada. Las cuentas que lista son las del ultimo
informe, que es la lista de cuentas que hay.

La campana de la barra y el paso «APIs» de Conexiones no siguen al selector (`gastoModeloVigente()`):
hablan siempre del ultimo informe, no del mes que alguien este revisando.

## Cuando el informe esta atrasado

El informe no entra solo: las piezas `descarga-google` y `descarga-meta` del Control de Automatizacion
siguen en `pendiente`, y la barra que lo subia a mano se quito en octubre de 2026. Asi que puede
quedarse viejo sin que nadie se entere, y entonces el pacing, los semaforos y los avisos son la foto
de la ultima fecha cargada aunque la pantalla se abra hoy.

El modulo, la campana y el correo lo dicen con el mismo criterio (`gastoInformeVejez()`, escrito en
el `index.html` y repetido en `scripts/correo/alertas-gasto.mjs`; si cambia uno, cambia el otro):

- **El ultimo informe es de un mes ya cerrado** (rojo). Lo grave: todo lo que se ve es del mes
  pasado. El correo lo pone en el asunto, porque «8 avisos, 1 para hoy» se lee como ocho marcas
  desbocadas hoy y son la foto del mes anterior.
- **Es del mes en curso pero lleva mas de 72 horas sin moverse** (ambar). El mes es el que toca,
  pero el gastado y las proyecciones son de esa fecha.

El aviso habla siempre del ultimo informe que hay, no del mes elegido en el selector: el problema es
que no haya uno al dia, y eso no cambia porque alguien se vaya a revisar un mes cerrado.

- `lr_suite_notificaciones`: correos que reciben las alertas diarias (fila `alertas-gasto`).
- `lr_suite_notificaciones_claves`: clave del envio automatico; no se lee por la API.

## Alertas diarias por correo

Todos los dias a las 8:30 a. m. de Lima, pg_cron le pide a GitHub (con una llave guardada en
`lr_suite_notificaciones_claves`, id `github-actions`) que corra `.github/workflows/alertas-gasto.yml`,
que corre `scripts/correo/alertas-gasto.mjs`: pide a Supabase el informe de gasto y la lista de
correos con `public.lr_suite_alertas_gasto(clave)` y manda un correo con la estetica de la Suite y lo
mismo que dice la campana de la barra superior:

- **Total del mes**: lo asignado (con lo de Google Ads y lo de Meta Ads), lo gastado y su porcentaje
  consumido, el ritmo diario con el gasto diario ideal para cerrar en lo asignado, y la proyeccion al
  cierre con su desvio.
- **Pacing por marca**: cada marca que no va en ritmo (sobregirada, se pasara, al limite, sin gasto o
  quedara corta), con lo asignado, lo gastado, lo consumido, la proyeccion y el ideal diario.
- **Gasto diario**: el ritmo que salto frente al mes anterior del mismo informe (desde +35 %, urgente
  desde +75 %, con un piso de 5 unidades de moneda al dia para no avisar de cuentas chicas), el tope
  diario cargado en Google que da para mas de 1.5 veces lo asignado, y las cuentas que gastan sin
  presupuesto.

Sale por el correo del hosting (alertas@limaretail.com). La hora la pone pg_cron y no el schedule de
GitHub, que el 22 de octubre de 2026 arranco cuatro horas y media tarde
(`alertas-gasto-hora-exacta.sql`).

Los umbrales y los textos estan en dos sitios: este script y la campana del `index.html`
(`gastoNotifPacingItems()`, `gastoNotifDiarioItems()`, `gastoModelo()`, `gastoPorMarca()`). Si cambia
uno, cambia en los dos: el correo y la campana tienen que decir lo mismo.

- **Correos**: se cambian con la ruedita del panel de Notificaciones (nombre opcional y correo). Viven
  en `lr_suite_notificaciones`, con las mismas politicas que el resto de la Suite
  (`is_lr_suite_pending_user()`). Una lista vacia no envia nada.
- **Clave**: la funcion solo responde con la clave de `lr_suite_notificaciones_claves`, que el workflow
  recibe por el secret `LR_GASTO_CLAVE`. La clave publicable de Supabase sale de `lr-suite-config.js`.
- **Puesta en marcha**: ejecutar `alertas-gasto-correo.sql` en el SQL Editor (al final muestra la
  clave) y crear en GitHub los secrets `LR_GASTO_CLAVE`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` y
  `SMTP_PASS`. Despues, `alertas-gasto-hora-exacta.sql`.
- **Probar**: `Actions -> Alertas de gasto diarias -> Run workflow`; con "Simulacion" marcada arma el
  correo sin enviarlo. En local, `node scripts/correo/alertas-gasto.mjs --datos datos.json --preview
  correo.html` escribe el correo con datos de un archivo (`{ "gasto": { "informes": {...},
  "cuentas": {...} }, "destinatarios": [...] }`).

## Venia del resumen de pendientes

Hasta octubre de 2026 el correo de las 8:30 era el resumen de pendientes
(`src/modules/lista-pendientes/BBDD/resumen-pendientes-*.sql`). La lista de correos es la misma, asi
que `alertas-gasto-correo.sql` renombra las filas `resumen-pendientes` a `alertas-gasto` en lugar de
crear otras: no se pierde ningun correo ya cargado ni la clave, y el secret nuevo `LR_GASTO_CLAVE`
lleva el mismo valor que tenia `LR_PENDIENTES_CLAVE`.

No importa en que orden se publique el `index.html` y se ejecute el SQL. Si el `index.html` nuevo
llega primero, la ruedita busca la fila `alertas-gasto`, que todavia no existe, y muestra la lista
vacia; si alguien le da Guardar ahi, crea esa fila sin correos. Por eso, cuando las dos filas
existen, la migracion se queda con la que tiene correos y no con la que se llama como toca, y avisa
por `notice` cuando le pasa los correos de la vieja a la nueva. Solo si la fila nueva ya tiene
correos propios manda ella, porque entonces son los ultimos que alguien guardo a proposito.
