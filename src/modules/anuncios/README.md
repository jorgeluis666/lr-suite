# Anuncios

Módulo del `index.html`. Muestra cada anuncio de una marca con su pieza de Drive al lado de sus
números, para ver qué creativo está detrás de cada resultado.

## De dónde salen los datos

```txt
Carpeta de la marca en Drive
├── 01 Meta Ads/        una hoja por mes, con una o las dos pestañas de abajo
│   ├── «Raw Data Report»  la descarga manual de Meta Ads
│   └── «Nexus Meta»       lo que escribe Nexus tres veces al día
└── 06 Artes/
    └── <campaña>/
        ├── <nombre del anuncio>.mp4        pieza única
        └── <nombre del anuncio> (Carrusel)/  una imagen por lámina
```

Las filas se suman por `Nombre del anuncio` y ese nombre es el que empareja con la pieza: el del
archivo sin extensión, o el de la subcarpeta sin el `(Carrusel)` del final.

### Las dos formas de la hoja del mes

**La descarga de Meta** («Raw Data Report», cabeceras en español y una fila por día × edad × sexo)
fue la única hasta octubre de 2026.

**La pestaña de Nexus** la escribe [Nexus](https://github.com/jorgeluis666/lima-retail-nexus) en la
misma hoja desde el 31 de octubre de 2026: el contrato `NEXUS_META_V1` en la fila 1, las cabeceras
en inglés en la fila 2 y una fila por día × nivel × anuncio. Trae los tres niveles (`campaign`,
`adset`, `ad`), que son **el mismo gasto contado tres veces**: solo se leen las filas de nivel `ad`.

Noviembre de 2026 arrancó con marcas cuyo «Raw Data Report» está vacío y todos sus días en la
pestaña de Nexus, así que el Web App lee las dos y las mezcla con tres reglas:

- **La descarga manda.** De Nexus solo entran los días que ella no trae; sumar los dos orígenes en
  el mismo día duplicaría el gasto, porque son la misma cuenta contada dos veces.
- **Sin `reach` ni `results`, la pestaña de Nexus se ignora entera** y el mes queda con el aviso que
  dice qué falta: activar `extended_fields` en el destino de esa cuenta en Nexus. Esas columnas
  llegan en el mismo bloque que `result_type`, y sin ellas esos días saldrían con 0 resultados y sin
  tipo de resultado, que en el módulo se lee como una caída real del cliente.
- **Los nombres crudos de Meta se traducen antes de mezclar** (`video_thruplay_watched_actions` →
  `ThruPlay`), que es como los escribe la descarga y como agrupa el módulo. Lo que no esté en la
  tabla `NEXUS_RESULTADOS` del `.gs` queda en blanco: en la tarjeta se ve mejor el hueco que la
  jerga de la API.

Nexus no trae «Interacciones con la publicación» ni el enlace de vista previa, así que un día que
solo venga de ahí queda con 0 interacciones y sin enlace.

**Una subcarpeta que termina en «(Carrusel)» es un anuncio de formato carrusel** y el módulo lo
muestra lámina por lámina, con flechas. Hoy las láminas no traen número en el nombre, así que el
orden no está confirmado y la tarjeta lo avisa.

Un anuncio sin pieza se muestra igual, con sus números y el hueco a la vista: así se ve qué falta
subir a Drive.

## Cómo se actualiza

`BBDD/sincronizacion-anuncios.sql` instala la sincronización en Supabase: pg_cron la corre todos
los días a las 06:40 de Lima y el botón «Actualizar» del módulo la fuerza cuando haga falta. Si no
cambió nada, la fila no se reescribe, así el navegador no vuelve a descargarla.

Los dos caminos no corren con el mismo presupuesto de tiempo. El cron llama a `lr_suite_ads_refresh()`
como `postgres`; el botón llega por la API con el rol `authenticated`, que trae un `statement_timeout`
corto, y desde que el lector entiende la pestaña de Nexus hay más que leer en cada hoja. Por eso
`sync_lr_suite_ads()` fija el suyo (`set statement_timeout = '60s'`), que solo vale mientras dura la
llamada. Sin eso el botón falla con el código **57014** y el tablero lo enseña como «Google tardó
demasiado en responder», que despista: el Web App contesta en un segundo, quien se cansa de esperar
es Postgres.

La hoja del mes trae miles de filas: la descarga de Meta son 2.121 y unos 700 KB para octubre de
Royal Baby, y la pestaña de Nexus una fila por día × nivel × anuncio. **No se descarga entera.** La
suma por anuncio el Web App de `apps-script/Codigo.gs`, que devuelve unos 10 KB ya agrupados, y que
también lista las carpetas de `06 Artes`.

**Las carpetas de cliente están en «Restringido»**, así que Drive no se puede leer sin
credenciales: el Web App corre con la cuenta dueña de las carpetas y es el único que entra a
Drive. Se despliega como «Ejecutar como: yo» y «Quién tiene acceso: cualquier persona», así que su
URL no puede ser la llave: exige un token guardado en las propiedades del script. Reconoce las dos
pestañas por su contenido y no por su nombre —las cabeceras de la descarga, el contrato en la
primera celda de la de Nexus—, y busca cada columna por su cabecera y no por su letra, para que
también lea una hoja reconstruida desde la API de Meta, que trae menos columnas y en otro orden.

**Al cambiar el `.gs` hay que pegarlo en el proyecto de Apps Script** y publicar una versión nueva
(Implementar > Administrar implementaciones > editar > Nueva versión), conservando la URL `/exec`:
este repositorio no lo despliega.

El Web App y las carpetas de cada marca se configuran una vez, desde el SQL Editor:

```sql
select public.lr_suite_ads_set_endpoint('<URL que termina en /exec>', '<TOKEN del script>');
select public.lr_suite_ads_set_brand('<marca>', '<ID de 01 Meta Ads>', '<ID de 06 Artes>');
```

El cuarto argumento, opcional, es cuántos meses se guardan de esa marca (3 por defecto; cada mes
son unos 12 KB). Para sacar una marca: `lr_suite_ads_remove_brand('<marca>')`.

## Dónde vive

Los datos ya sumados van en una fila de `lr_suite_private_data`, clave `ads`, que el módulo lee
después del login (`loadPrivateAds`). Los ids de carpetas no van en este repositorio, que es
público: viven en la clave `ads-config`. La forma del payload está en `BBDD/anuncios.sql`.

Las piezas se piden a Drive, no a Supabase: la miniatura al dibujar la tarjeta (`loading="lazy"`,
con reintentos porque Drive las genera a pedido) y el video solo cuando se pulsa reproducir. Eso lo
pide el navegador con la sesión de Google de quien está mirando el tablero, así que las piezas solo
se ven si esa cuenta tiene acceso a la carpeta de la marca.

## Qué falta

- La sincronización corre una vez al día. No se entera de un cambio en Drive en el momento: si
  acabas de subir una pieza, pulsa «Actualizar».
- El módulo no filtra por campaña ni compara meses.
- La tabla `NEXUS_RESULTADOS` está incompleta: de Terminal Pesquero llega
  `conversions:contact_website`, que no tiene todavía su nombre de la descarga, así que esas
  tarjetas muestran el número de resultados con el tipo en blanco. Se completa mirando un mes que
  tenga las dos pestañas, para leer el par en la misma cuenta.
- El orden de las láminas de un carrusel no está resuelto: las carpetas no traen número en el
  nombre del archivo, así que van alfabéticas y la tarjeta lo avisa.
