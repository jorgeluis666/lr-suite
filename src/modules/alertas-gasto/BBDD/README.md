# BBDD - Alertas de Gasto

Esta carpeta concentra lo que el modulo de Alertas de Gasto necesita en Supabase.

## Archivos

- `ingesta-nexus.sql`: la funcion con la que Nexus escribe el gasto de cada plataforma. **Es el
  camino vigente**: la carga la trae Nexus desde las APIs, no Supabase desde Drive.
- `presupuestos-concurrentes.sql`: las dos funciones con las que el modulo guarda un presupuesto o
  una marca sin reescribir el payload entero.
- `sincronizacion-gasto.sql`: el camino anterior (informe programado de Google Ads → Drive → Web App
  → pg_cron). **Nunca se instalo** y lo reemplaza `ingesta-nexus.sql`; se conserva por si alguna vez
  hace falta leer un informe de una carpeta.
- `alertas-gasto-correo.sql`: correos de las alertas diarias y la funcion que entrega el informe.
- `alertas-gasto-hora-exacta.sql`: pg_cron que lanza el correo a las 8:30 a. m. exactas.
- `../apps-script/Codigo.gs`: el Web App que lee la carpeta y devuelve el informe ya sumado.

## De donde entra el informe

```txt
Nexus (API de Google Ads, cuentas del MCC) ─┐
                                            ├─→ lr_suite_gasto_set_informe() → lr_suite_private_data
Nexus (API de Meta Ads, cuentas por marca) ─┘
```

Hasta el 1 de noviembre de 2026 el informe entraba por una barra de subida dentro del modulo. Esa
barra se quito y nada la reemplazo: el 3 de noviembre de 2026 se comprobo que **ninguna** de las tres
piezas del reemplazo existia —ni el informe programado en Drive, ni el proyecto de Apps Script, ni
`sincronizacion-gasto.sql` en Supabase (sin cron `lr-suite-gasto-daily`, sin fila `gasto-status` y
sin la pieza registrada)—, asi que el modulo llevaba trece dias mostrando el informe del 21 de
octubre. Por eso la carga se movio a Nexus, que ya habla con las dos APIs.

Cada llamada escribe las cuentas de **una** plataforma en **un** mes y conserva las de la otra, que
llegan en su propia llamada. Es todo o nada: si una fila viene mal, no se escribe ninguna, porque un
mes a medias se lee como marcas que no gastaron y eso la pantalla no lo avisa.

El contrato de cada fila —`id`, `nombre`, `moneda`, `coste`, `diario`, `estado`, y `monedaConvertida`
y `costeConvertido` para las cuentas que facturan en otra moneda— es el mismo que ya tenian las filas
del informe subido a mano, asi que el modulo no distingue de donde vino el dato.

**Lo que esta carga sigue sin resolver:** que las dos plataformas cubran la misma ventana de dias. El
ritmo diario y la proyeccion se calculan sobre `desde`/`hasta` del informe, que es uno solo para las
dos, y manda la ultima llamada. `gasto-status.ventanas` guarda el periodo de cada plataforma para que
el desajuste se vea; la salida de verdad es que cada plataforma lleve su ventana dentro del informe, y
eso es un cambio del modulo.

### Puesta en marcha

1. En el SQL Editor, ejecutar `ingesta-nexus.sql`. Al final muestra la clave de la fila
   `gasto-ingesta` de `lr_suite_notificaciones_claves`.
2. Cargar esa clave en Nexus (`config/local.php`, fuera del control de versiones) junto con la URL
   del proyecto de Supabase y su clave publicable, que son las de `lr-suite-config.js`.
3. Comprobar la llamada de extremo a extremo con el mes de prueba que trae el archivo al final, y
   borrarlo despues.
4. Dejar el cron de Nexus corriendo antes de las 6:10 de Lima, que es cuando el resto de la cadena
   espera el dato, y antes del correo de las 8:30.
5. Comprobar que `gasto-status` trae el periodo y las cuentas que se esperan, que la pieza `gasto`
   sale «activo» en el Control de Automatizacion y que el modulo deja de mostrar el aviso de informe
   atrasado.

El camino viejo, por si hiciera falta: `../apps-script/Codigo.gs` es un Web App que lee de una
carpeta de Drive **el archivo modificado mas recientemente** con la columna «Nombre de cuenta» y lo
devuelve ya sumado por cuenta; `sincronizacion-gasto.sql` lo llama desde un pg_cron. Nunca se
instalo ninguno de los dos.

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

### Dos personas presupuestando a la vez

Los presupuestos los cargan Jorge Luis y Diego sobre la misma fila, asi que el modulo no escribe el
payload completo: `presupuestos-concurrentes.sql` instala
`lr_suite_gasto_set_presupuesto(cuenta, mes, monto)` y `lr_suite_gasto_set_marca(cuenta, marca)`, que
parchean dentro de la base solo la ruta que cambio, con la fila bloqueada (`for update`), y devuelven
el payload ya guardado para que el navegador adopte de paso lo que haya cargado el otro.

Hasta el 3 de noviembre de 2026 cada cambio subia `informes` + `cuentas` enteros desde la copia leida
al abrir la vista, asi que el que guardaba segundo borraba en silencio los presupuestos del primero.
Ese mismo dia se vio la otra mitad del problema: el payload se leia una sola vez por carga de pagina,
y una pestaña abierta desde antes mostraba ceros donde el otro ya habia cargado los presupuestos del
mes. Ahora el modulo relee al abrir la vista, al volver a la pestaña y cuando su copia lleva mas de un
minuto (`GASTO_REFRESCO`), nunca mientras alguien esta escribiendo en un presupuesto.

Si el SQL no esta instalado, el modulo no guarda nada y lo dice: «Falta instalar
src/modules/alertas-gasto/BBDD/presupuestos-concurrentes.sql en Supabase» (PostgREST responde
`PGRST202` cuando la funcion no existe).

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
- **Pacing por canal y dia**: el mismo grafico del panel para Google Ads, Meta Ads y las dos juntas:
  la linea del presupuesto repartido por igual entre los dias del mes, lo gastado hasta el dia del
  informe y la proyeccion al cierre, con una franja en el dia hasta donde llega el informe. Va
  dibujado con tablas y no con el SVG del panel, porque Gmail borra los `<svg>` y bloquea las
  imagenes en `data:`.
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
(`gastoNotifPacingItems()`, `gastoNotifDiarioItems()`, `gastoModelo()`, `gastoPorMarca()`). El
grafico por canal tambien: `pacingCanales()` y `graficoCanalHtml()` en el script, `gastoPacingCanales()`
y `gastoCanalChartHtml()` en el `index.html`. Si cambia uno, cambia en los dos: el correo y la campana
tienen que decir lo mismo.

- **Correos**: se cambian con la ruedita del panel de Notificaciones (nombre opcional y correo). Viven
  en `lr_suite_notificaciones`, con las mismas politicas que el resto de la Suite
  (`is_lr_suite_pending_user()`). Una lista vacia no envia nada.
- **Clave**: la funcion solo responde con la clave de `lr_suite_notificaciones_claves`, que el workflow
  recibe por el secret `LR_GASTO_CLAVE`. La clave publicable de Supabase sale de `lr-suite-config.js`.
- **Puesta en marcha**: ejecutar `alertas-gasto-correo.sql` en el SQL Editor (al final muestra la
  clave) y crear en GitHub los secrets `LR_GASTO_CLAVE`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` y
  `SMTP_PASS`. Despues, `alertas-gasto-hora-exacta.sql`.
- **Si deja de salir**: la pieza `correo-gasto` del Control de Automatizacion lo dice. Al terminar, el
  script anota ahi su corrida con `lr_suite_correo_anotar()`, asi que una corrida de pg_cron correcta sin
  la del script significa que se cayo el workflow, y una del script con error significa que fallo el
  envio. Ver `src/modules/control-automatizacion/BBDD/correos-automatizacion.sql`.
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
