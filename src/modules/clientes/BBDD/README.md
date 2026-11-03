# BBDD · clientes

El catálogo de proyectos está escrito en el código y se renderiza de forma
estática. De Supabase solo salen la carpeta de Drive de cada marca y la lista de
archivadas: ver «Las carpetas de Drive» y «Las marcas archivadas».

## Fuente de datos actual

El catálogo vive por duplicado: `clientesProyectos`, dentro del `index.html`, es el
que ve la suite publicada, y la lista de semillas (`SEEDS`) de `data.ts`, la del
módulo de Next. Llevan las mismas marcas, pero no los mismos campos. Estos son los
del `index.html`:

| Campo         | Descripción                                                        |
| ------------- | ------------------------------------------------------------------ |
| `repo`        | Nombre del repositorio en GitHub. Es el id de la marca; se omite en la que todavía no tiene dashboard. |
| `clave`       | Id de la marca cuando no hay repositorio (hoy solo Llanos Import).  |
| `nombre`      | Nombre visible del dashboard.                                       |
| `cliente`     | Cliente dueño del proyecto (`Lima Retail` para trabajo interno).    |
| `categoria`   | Con mayúscula inicial: `Objetivos`, `Ventas`, `Archivos`. Encabeza el trabajo interno (`Lima Retail · Objetivos`) y es la etiqueta con la que se archiva. |
| `descripcion` | Una línea sobre qué resuelve el dashboard.                          |
| `publicado`   | `false` cuando el repo aún no tiene GitHub Pages activo.            |
| `envivo`      | `true` arma `<marca>.limaretail.com`; `false` lo deja pendiente; una cadena reemplaza el subdominio. |

**No hay campo `tipo`.** Cliente o trabajo interno sale de `cliente === "Lima
Retail"`: de ahí salen el filtro «Lima Retail», el orden de los grupos y el
`data-scope` de cada tarjeta.

`SEEDS` sí trae `tipo` (`cliente` o `interno`) y escribe la categoría en
minúsculas, con los valores de `types.ts`: `objetivos`, `ventas`, `reportes`,
`herramientas`, `planificacion`, `archivos` y `tests`. Dar de alta o quitar una
marca obliga a tocar los dos archivos.

Las URLs se derivan del `repo`:

- Repositorio: `https://github.com/jorgeluis666/<repo>`
- Dashboard: `https://jorgeluis666.github.io/<repo>/`

Una marca sin `repo` no tiene ninguna de las dos y su tarjeta muestra solo Drive.

## Los cuatro accesos de cada marca

Cada tarjeta muestra Repo, Pages y En vivo en el paso «Repos», y Drive en «Copias
en Drive». `Repo` y `Pages` se derivan del nombre del repositorio y `En vivo` del
nombre de la marca; `Drive` llega de Supabase. Un acceso sin URL se pinta en gris
con borde punteado y no es clicable; la marca que no tiene repositorio no muestra
ni Repo ni Pages.

## Las carpetas de Drive

Este repositorio es público y el id de una carpeta deja ver qué marcas atiende la
agencia y cómo está armado su Drive, así que las carpetas no se guardan aquí.
Viven en una fila de `lr_suite_private_data`, con la clave `clientes-drive`, que
solo leen los dos usuarios de la suite.

La fila es un objeto `{ "<clave de la marca>": "<url de la carpeta>" }`. El módulo
la lee después del login (`loadClientesPrivados`, en el `index.html`) y busca cada
carpeta por esa clave: el `repo` de la marca, o su `clave` cuando no tiene
repositorio. Es una lectura de menos de 1 KB por sesión.
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

## Las vistas

«Conexiones» muestra una tarjeta por marca con el flujo de **Nexus**, en el orden en que viaja el
dato. Las tarjetas abren minimizadas (nombre, semáforo y pendientes); cada quien despliega las que
quiere revisar y el panel lo recuerda en ese navegador.

```txt
1 APIs            →  2 Repos             →  3 Estado          →  4 Copias en Drive
Google Ads, Meta     dashboard de la marca   lo peor de los       carpetas de la marca
(Alertas de Gasto    (Repo, Pages,           otros tres pasos     (clientes-drive y
 y Anuncios)          En vivo)                                     carpetas-clientes)
```

- **APIs**: cuentas de Google Ads y Meta Ads asignadas a la marca en Alertas de Gasto, con la fecha
  del último informe; Meta suma el último mes sincronizado en Anuncios. Sin cuenta asignada queda en
  gris. Un informe de más de tres días queda en ámbar.
- **Repos**: cada proyecto de la marca; verde si está publicado en GitHub Pages, gris si todavía no.
- **Estado**: rojo si algún paso tiene algo que arreglar, ámbar si hay algo atrasado, verde si no.
- **Copias en Drive**: la rama de carpetas, con el nombre fuera del estándar en rojo.

Todo sale de lo que el panel ya tiene cargado: no hace consultas nuevas salvo la de Alertas de Gasto
(una fila), que se lee al abrir la vista.

«Automatización» es el proceso que antes vivía en su propio módulo: las etapas por las que pasan los
datos de todas las marcas, con el estado de cada pieza, sus corridas y el botón «Ejecutar ahora». Se
documenta en `src/modules/control-automatizacion/`.

## Cómo agregar un proyecto

1. Agregar su entrada a `clientesProyectos`, en el `index.html`, que es lo que ve
   la suite publicada, y la suya a `SEEDS`, en `src/modules/clientes/data.ts`, con
   los campos que pide cada uno. Una marca en un solo archivo queda a medias.
2. Si el repo todavía no tiene GitHub Pages publicado, marcar `publicado: false`.
3. Poner `envivo: true` cuando el subdominio de la marca quede publicado.
4. Sumar su carpeta de Drive a la clave `clientes-drive` en Supabase, con el
   `update` que está al final de `clientes-drive.sql`, bajo la clave de la marca.

## Migración futura a Supabase

Si el catálogo crece o debe editarse desde la app, la tabla esperada es
`cliente_proyectos` con las mismas columnas del catálogo de arriba más
`workspace_id`, `orden`, `created_at` y `updated_at`. Mientras no exista, el alta
y la baja de una marca siguen siendo una edición de los dos archivos y una
publicación.
