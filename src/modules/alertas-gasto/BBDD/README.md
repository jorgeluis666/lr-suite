# BBDD - Alertas de Gasto

Esta carpeta concentra lo que el modulo de Alertas de Gasto necesita en Supabase.

## Archivos

- `sincronizacion-gasto.sql`: carga diaria del informe de Google Ads desde su carpeta de Drive.
- `presupuestos-concurrentes.sql`: las dos funciones con las que el modulo guarda un presupuesto o
  una marca sin reescribir el payload entero.
- `alertas-gasto-correo.sql`: correos de las alertas diarias y la funcion que entrega el informe.
- `alertas-gasto-hora-exacta.sql`: pg_cron que lanza el correo a las 8:30 a. m. exactas.
- `../apps-script/Codigo.gs`: el Web App que lee la carpeta y devuelve el informe ya sumado.

## De donde entra el informe

```txt
Google Ads (informe programado) → carpeta de Drive → Web App → pg_cron 6:10 → lr_suite_private_data
```

Hasta el 1 de noviembre de 2026 el informe entraba por una barra de subida dentro del modulo. Esa
barra se quito y nada la reemplazo, asi que el ultimo informe quedo congelado en el 21 de octubre:
`sincronizacion-gasto.sql` es el reemplazo.

El Web App (`../apps-script/Codigo.gs`) corre con la cuenta dueña de la carpeta, lee **el archivo
modificado mas recientemente** que tenga la columna «Nombre de cuenta» y devuelve unos pocos KB ya
sumados por cuenta. La lectura del CSV es la misma que hacia el navegador, movida tal cual: es la
que ya habia leido bien los informes reales.

**Las cuentas de Meta del mes no se tocan.** Entran por otro camino (hoy a mano; el contrato de la
fila esta documentado para que lo escriba la conexion de Meta de Nexus) y una carga de Google que
las borrara dejaria media pantalla vacia.

**Lo que esta carga no resuelve:** que las dos plataformas cubran la misma ventana de dias. El
ritmo diario y la proyeccion se calculan sobre los dias que cubre el informe, asi que si Google
avanza al dia 30 y las cuentas de Meta se quedaron en el 21, el pacing de Meta sale corto.
`gasto-status` guarda `cuentasMetaHeredadas` para que se vea; la salida de verdad es que cada
plataforma traiga su propia ventana, y eso es un cambio del modulo.

### Puesta en marcha

1. En **Google Ads**, programar el «Informe de rendimiento» a nivel de cuenta del MCC para que se
   guarde en una carpeta de Drive, con la frecuencia diaria y el periodo del mes en curso. Tiene que
   llevar al menos «Nombre de cuenta» y «Coste»; el modulo tambien usa «ID de cliente externo de la
   cuenta», «Estado de la cuenta», «Codigo de moneda», «Coste (moneda convertida)», «Codigo de
   moneda convertida», «Presupuesto diario total», «Impr.», «Clics» y «Conversiones».
2. Desplegar `../apps-script/Codigo.gs` como Web App con la cuenta que ve esa carpeta (los pasos
   estan en su cabecera) y anotar la URL `/exec` y el TOKEN.
3. En el SQL Editor:
   ```sql
   select public.lr_suite_gasto_set_endpoint('<URL /exec>', '<TOKEN>');
   select public.lr_suite_gasto_refresh('manual');
   ```
4. Comprobar que `gasto-status` trae el periodo y las cuentas que se esperan, y que el modulo deja
   de mostrar el aviso de informe atrasado.

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
