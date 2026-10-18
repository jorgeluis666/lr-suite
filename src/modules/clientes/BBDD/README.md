# BBDD · clientes

El catálogo de proyectos vive en `src/modules/clientes/data.ts` y se renderiza de
forma estática. Lo único que sale de Supabase es la carpeta de Drive de cada
marca: ver «Las carpetas de Drive».

## Fuente de datos actual

`data.ts` mantiene una lista de semillas (`SEEDS`) con estos campos:

| Campo         | Descripción                                                        |
| ------------- | ------------------------------------------------------------------ |
| `repo`        | Nombre del repositorio en GitHub. Es el id único del proyecto.      |
| `nombre`      | Nombre visible del dashboard.                                       |
| `cliente`     | Cliente dueño del proyecto (`Lima Retail` para trabajo interno).    |
| `tipo`        | `cliente` o `interno`.                                              |
| `categoria`   | `objetivos`, `ventas`, `reportes`, `herramientas`, `planificacion`, `tests`. |
| `descripcion` | Una línea sobre qué resuelve el dashboard.                          |
| `publicado`   | `false` cuando el repo aún no tiene GitHub Pages activo.            |
| `envivo`      | `true` arma `<marca>.limaretail.com`; `false` lo deja pendiente; una cadena reemplaza el subdominio. |

Las URLs se derivan del `repo`:

- Repositorio: `https://github.com/jorgeluis666/<repo>`
- Dashboard: `https://jorgeluis666.github.io/<repo>/`

## Los cuatro accesos de cada marca

Cada tarjeta muestra Drive, Repo, Pages y En vivo. `Repo` y `Pages` se derivan
del nombre del repositorio y `En vivo` del nombre de la marca; `Drive` llega de
Supabase. Un acceso sin URL se pinta en gris con borde punteado y no es clicable.

## Las carpetas de Drive

Este repositorio es público y el id de una carpeta deja ver qué marcas atiende la
agencia y cómo está armado su Drive, así que las carpetas no se guardan aquí.
Viven en una fila de `lr_suite_private_data`, con la clave `clientes-drive`, que
solo leen los dos usuarios de la suite.

La fila es un objeto `{ "<nombre del repo>": "<url de la carpeta>" }`. El módulo
la lee después del login (`loadClientesPrivados`, en el `index.html`) y busca cada
carpeta por el nombre del repositorio. Es una lectura de menos de 1 KB por sesión.
Una marca sin entrada muestra su acceso «Drive» en gris.

- Plantilla, sin datos: `clientes-drive.sql`, en esta misma carpeta.
- Los ids reales: `private/clientes-drive-seed.local.sql`, que está en
  `.gitignore`.

## Las marcas archivadas

Una marca que deja de ser cliente no se borra: su historial sigue sirviendo. El
botón «Archivar», en la cabecera de cada tarjeta, la saca de la lista y la deja
en la pestaña «Archivadas», donde «Restaurar» la devuelve. Las archivadas no
suman en el resumen de arriba ni aparecen al filtrar por Clientes o Lima Retail.

La lista vive en `lr_suite_private_data`, con la clave `clientes-archivadas`, y
es un arreglo con los nombres de marca tal como encabezan la tarjeta (el trabajo
interno se archiva por categoría: `Lima Retail · Objetivos`). Viaja en la misma
lectura que `clientes-drive`, así que no cuesta una consulta más. Mientras la
fila no exista mandan las de `CLIENTES_ARCHIVADAS_INICIALES`, en el `index.html`:
Casiopia, Llanos Import y Rekluta, que ya estaban archivadas cuando se hizo la
opción.

## Las tres vistas

«Tarjetas» es la de siempre. «Mapa» dibuja la cadena de cada marca (ver abajo).
«Automatización» es el proceso que antes vivía en su propio módulo: las etapas por
las que pasan los datos de todas las marcas, con el estado de cada pieza, sus
corridas y el botón «Ejecutar ahora». Se documenta en
`src/modules/control-automatizacion/`.

## El mapa de sincronización

El mapa dibuja,
por cada marca, la cadena que recorre un dato hasta el dashboard:

```txt
Carpeta en Drive  →  01 Meta Ads  →  06 Artes  →  Dashboard
```

Cada paso lleva el semáforo del Control de Automatización: **verde** si está
resuelto, **rojo** si hay algo que arreglar, **ámbar** si la sincronización está
atrasada y **gris** si todavía no existe, que no es lo mismo que estar roto.
Bajo la cadena aparecen los nombres de las carpetas de campaña encontradas en
`06 Artes`.

No pide nada a Supabase: se arma con lo que el módulo ya tiene cargado, el link
de la carpeta (`clientes-drive`) y la última sincronización de anuncios (`ads`).
Por eso una marca que no esté configurada en el módulo de Anuncios muestra sus
tres últimos pasos en gris.

## Cómo agregar un proyecto

1. Agregar una entrada a `SEEDS` en `src/modules/clientes/data.ts`.
2. Si el repo todavía no tiene GitHub Pages publicado, marcar `publicado: false`.
3. Poner `envivo: true` cuando el subdominio de la marca quede publicado.
4. Sumar su carpeta de Drive a la clave `clientes-drive` en Supabase, con el
   `update` que está al final de `clientes-drive.sql`.

La suite estática mantiene la misma tabla en `clientesProyectos`, dentro de
`index.html`.

## Migración futura a Supabase

Si el catálogo crece o debe editarse desde la app, la tabla esperada es
`cliente_proyectos` con las mismas columnas de la tabla anterior más
`workspace_id`, `orden`, `created_at` y `updated_at`.
