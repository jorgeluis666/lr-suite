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

## Dónde vive

Los datos ya sumados van en una fila de `lr_suite_private_data`, clave `ads`, que el módulo lee
después del login (`loadPrivateAds`). Hoy son ~12 KB para una marca y un mes. Los ids de carpetas y
archivos no van en este repositorio, que es público: ver `BBDD/anuncios.sql`.

Las piezas se piden a Drive, no a Supabase: la miniatura al dibujar la tarjeta (`loading="lazy"`,
con reintentos porque Drive las genera a pedido) y el video solo cuando se pulsa reproducir. Los
archivos tienen que estar compartidos como «cualquiera con el enlace».

## Qué falta

- La fila `ads` se carga a mano. Todavía no hay una sincronización que lea la hoja y la carpeta sola;
  cuando exista, se registra como pieza en el Control de Automatización.
- El módulo no filtra por campaña ni compara meses.
