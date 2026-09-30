# BBDD · clientes

El módulo `clientes` no usa Supabase todavía. El catálogo de proyectos vive en
`src/modules/clientes/data.ts` y se renderiza de forma estática.

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
| `drive`       | Carpeta de Drive de la marca. Vacío mientras no se cargue.          |
| `envivo`      | `true` arma `<marca>.limaretail.com`; `false` lo deja pendiente; una cadena reemplaza el subdominio. |

Las URLs se derivan del `repo`:

- Repositorio: `https://github.com/jorgeluis666/<repo>`
- Dashboard: `https://jorgeluis666.github.io/<repo>/`

## Los cuatro accesos de cada marca

Cada tarjeta muestra Drive, Repo, Pages y En vivo. `Repo` y `Pages` se derivan
del nombre del repositorio y `En vivo` del nombre de la marca; solo `Drive` se
carga a mano. Un acceso sin
URL se pinta en gris con borde punteado y no es clicable.

## Cómo agregar un proyecto

1. Agregar una entrada a `SEEDS` en `src/modules/clientes/data.ts`.
2. Si el repo todavía no tiene GitHub Pages publicado, marcar `publicado: false`.
3. Pegar la carpeta de Drive en `drive`.
4. Poner `envivo: true` cuando el subdominio de la marca quede publicado.

La suite estática mantiene la misma tabla en `clientesProyectos`, dentro de
`index.html`.

## Migración futura a Supabase

Si el catálogo crece o debe editarse desde la app, la tabla esperada es
`cliente_proyectos` con las mismas columnas de la tabla anterior más
`workspace_id`, `orden`, `created_at` y `updated_at`.
