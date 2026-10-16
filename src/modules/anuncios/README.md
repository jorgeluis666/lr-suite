# Anuncios

Módulo del `index.html`. Muestra cada anuncio de una marca con su pieza de Drive al lado de sus
números, para ver qué creativo está detrás de cada resultado.

## De dónde salen los datos

```txt
Carpeta de la marca en Drive
├── 01 Meta Ads/        una hoja por mes, pestaña «Raw Data Report» (export de Meta Ads)
└── 06 Artes/
    └── <campaña>/
        ├── <nombre del anuncio>.mp4        pieza única
        └── <nombre del anuncio> (Carrusel)/  una imagen por lámina
```

El export trae una fila por día × edad × sexo. Las filas se suman por `Nombre del anuncio` y ese
nombre es el que empareja con la pieza: el del archivo sin extensión, o el de la subcarpeta sin el
`(Carrusel)` del final.

**Una subcarpeta que termina en «(Carrusel)» es un anuncio de formato carrusel** y el módulo lo
muestra lámina por lámina, con flechas. Hoy las láminas no traen número en el nombre, así que el
orden no está confirmado y la tarjeta lo avisa.

Un anuncio sin pieza se muestra igual, con sus números y el hueco a la vista: así se ve qué falta
subir a Drive.

## Cómo se actualiza

`BBDD/sincronizacion-anuncios.sql` instala la sincronización en Supabase: pg_cron la corre todos
los días a las 06:40 de Lima y el botón «Actualizar» del módulo la fuerza cuando haga falta. Si no
cambió nada, la fila no se reescribe, así el navegador no vuelve a descargarla.

El export de Meta trae una fila por día, edad y sexo: para octubre de Royal Baby son 2.121 filas y
unos 700 KB. **No se descarga entero.** Se le pide a Google que lo sume por anuncio con la Google
Visualization API (`gviz/tq`), que devuelve unos 10 KB ya agrupados. Las carpetas se listan con la
vista pública de Drive, sin credenciales.

Las carpetas de cada marca se configuran una vez, desde el SQL Editor:

```sql
select public.lr_suite_ads_set_brand('<marca>', '<ID de 01 Meta Ads>', '<ID de 06 Artes>');
```

El cuarto argumento, opcional, es cuántos meses se guardan de esa marca (3 por defecto; cada mes
son unos 12 KB). Para sacar una marca: `lr_suite_ads_remove_brand('<marca>')`.

## Dónde vive

Los datos ya sumados van en una fila de `lr_suite_private_data`, clave `ads`, que el módulo lee
después del login (`loadPrivateAds`). Los ids de carpetas no van en este repositorio, que es
público: viven en la clave `ads-config`. La forma del payload está en `BBDD/anuncios.sql`.

Las piezas se piden a Drive, no a Supabase: la miniatura al dibujar la tarjeta (`loading="lazy"`,
con reintentos porque Drive las genera a pedido) y el video solo cuando se pulsa reproducir. Los
archivos tienen que estar compartidos como «cualquiera con el enlace».

## Qué falta

- La sincronización corre una vez al día. No se entera de un cambio en Drive en el momento: si
  acabas de subir una pieza, pulsa «Actualizar».
- El módulo no filtra por campaña ni compara meses.
- El orden de las láminas de un carrusel no está resuelto: las carpetas no traen número en el
  nombre del archivo, así que van alfabéticas y la tarjeta lo avisa.
