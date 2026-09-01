# Auditoría técnica — LR Suite

**Fecha:** 2026-09-01 · **Commit auditado:** `d0e3e98` (`main`) · **Árbol:** limpio

Revisión del repositorio local y de `jorgeluis666/lr-suite` en GitHub.

## Veredicto

La suite funciona y se despliega: `eslint` y `tsc` pasan sin errores, y `next build`
compila las 5 rutas cuando existen las variables de entorno.

Hay tres problemas estructurales: una política de base de datos que abre escritura
pública sobre los Pendientes, una app Next cuyo contenido queda tapado por el menú
lateral en todas las páginas, y un historial de git partido en dos linajes sin
ancestro común. Además, el producto real vive en `index.html` (46 de los 50 commits
de `main`), mientras la app Next se mantiene casi sin tocar.

**Recuento:** 1 crítico · 3 altos · 4 medios · 4 bajos (13 hallazgos)

---

## Seguridad

### 01 — CRÍTICO · RLS concede lectura y escritura al rol `anon`

`lr_suite_pending_state`, `lr_suite_pending_backups` y `lr_suite_pending_history`
aceptan a cualquiera cuyo rol sea `anon`, no solo a los dos correos autorizados,
en `SELECT`, `INSERT` y `UPDATE`:

- `src/modules/lista-pendientes/BBDD/static-authenticated-state.sql:29,36,43,47`
- `src/modules/lista-pendientes/BBDD/pending-state-backups.sql:25,32`
- `src/modules/lista-pendientes/BBDD/completed-history-archive.sql:21,28`
- `src/modules/lista-pendientes/BBDD/pending-backup-trigger-and-view.sql:82`
  (`grant select … to anon`)

El repositorio es **público** y la URL y la clave anónima de Supabase están en claro
en `lr-suite-config.js` (además se sirven desde `index.html`). Con esa clave,
cualquiera puede leer el estado completo de Pendientes y sobrescribirlo. Los
respaldos y el historial tienen la misma política, así que no protegen.

**No verificado en vivo:** la salida de red del entorno de auditoría está bloqueada.
Confirmarlo contra el proyecto Supabase antes de asumir nada más.

**Arreglo:** sustituir `auth.role() = 'anon'` por `auth.role() = 'authenticated'` en
las seis políticas y revocar el `grant select … to anon` de la vista. Si el
`index.html` estático necesita leer sin sesión, que sea vía una función
`security definer` acotada, no acceso directo a la tabla.

---

## Local — la app Next

### 02 — ALTO · El menú lateral tapa 288 px de contenido en todas las páginas

`src/app/layout.tsx` + `src/app/components/sidebar.tsx`. El `<aside>` es `fixed`
con `w-72`, así que sale del flujo del `flex` del `<body>`; el `<main>` arranca en
x=0 y ocupa todo el ancho. No existe ningún `ml-72` / `pl-72` en el proyecto.

Medido en Chromium a 1440×900:

```
aside : { x: 0, y: 0, w: 288, h: 900 }   ← position: fixed
main  : { x: 0, y: 0, w: 1440, h: 900 }  ← sin desplazamiento
```

No se nota en el login (centrado con `mx-auto`), sí en `/manychat`, `/cotizaciones`
y `/`.

**Arreglo:** desplazar el `<main>` el ancho del menú, sincronizado con el estado
`collapsed` (subirlo a un contexto compartido), o quitar el `fixed` del `<aside>` y
dejarlo en el `flex` con `sticky top-0 h-screen`.

### 03 — ALTO · `npm run build` falla en un clon limpio

```
$ npm run build
  ✓ Compiled successfully
  Error occurred prerendering page "/"
  Error: supabaseUrl is required.
  ⨯ Next.js build worker exited with code: 1
```

Con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` definidas, el build
pasa (7/7 páginas). No hay `.env.example` y el README no menciona ninguna variable.

**Arreglo:** añadir `.env.example`, documentarlo en el README, y hacer que
`src/utils/supabase/client.ts` lance un error explícito nombrando la variable que
falta en vez de reventar dentro de `createClient`.

### 04 — MEDIO · El enlace «UTM Builder» del menú devuelve 404

`src/app/components/sidebar.tsx:29` apunta a `/utm-builder`, que no tiene carpeta en
`src/app/`. El generador existe solo dentro de `index.html`.

### 05 — MEDIO · Cotizaciones vive solo en `localStorage`

`src/app/cotizaciones/page.tsx` no toca Supabase (0 llamadas). Los datos salen de la
constante `RAW_QUOTES` (línea 43) y las ediciones se guardan en `localStorage`
(línea 123). Cada persona ve sus propios números; no hay historial compartido, ni
respaldo, ni auditoría de lo facturado. `src/modules/seguimiento-cotizaciones/BBDD/`
solo tiene un README, sin esquema.

### 06 — MEDIO · ManyChat es una maqueta publicada en el menú principal

`src/modules/manychat/components/manychat-module.tsx` se alimenta de `LEADS_MOCK`.
La página lo admite en su subtítulo, pero está en el menú al mismo nivel que los
módulos reales.

### 07 — BAJO · 23 `alert()` bloqueantes en Control ROAS

`src/app/page.tsx`. El commit `d7593d0` ya hizo el cambio a validación en línea para
Pendientes; Control ROAS quedó fuera.

### 08 — BAJO · Dos detalles de sincronización en Pendientes

`src/modules/lista-pendientes/components/lista-pendientes-module.tsx`:

- `ensureInitialTasks()` cuenta filas y siembra si hay cero — dos personas abriendo
  un workspace vacío a la vez siembran las dos.
- `scheduleTaskSave()` difiere 350 ms pero ningún `useEffect` vacía `saveTimersRef`
  al desmontar; si alguien edita y navega, el error del guardado nunca llega a la UI.

---

## GitHub — historial y proceso

### 09 — ALTO · Historial partido en dos linajes sin ancestro común

```
$ git merge-base origin/main origin/codex/actualizar-pendientes-jorge
  (vacío)

  main   50 commits   raíz 920ad1d  2026-07-09
  codex  79 commits   raíz b2526f9  2026-04-14  "primer commit"
```

El código de `main` es el bueno y más completo — no se perdió producto. Se perdió
trazabilidad: `git log` / `blame` / `bisect` sobre `main` no ven nada anterior a
julio, y los PR #1–#3 (y sus merges) solo son alcanzables desde la rama `codex`.

**Arreglo:** decidirlo explícitamente. Si el linaje viejo no importa, etiquetarlo
(`git tag archivo/pre-julio-2026 origin/codex/…`), borrar la rama y dejar constancia
en el README. Si importa, se puede injertar con `git replace --graft` +
`git filter-repo`, pero reescribe todos los SHA.

### 10 — MEDIO · El producto real es `index.html`, y duplica a la app Next

11 353 líneas / 429 KB, con un único `<script>` en línea de 7 752 líneas que
reimplementa Pendientes, Cotizaciones y ManyChat, más UTM Builder y Mapa de ideas
que no existen en la app Next.

```
$ git log --name-only origin/main | sort | uniq -c | sort -rn | head -5
  46  index.html                      ← de 50 commits en main
   4  src/app/cotizaciones/page.tsx
   4  lr-suite-config.js
   2  src/app/page.tsx                ← 1 796 líneas, tocado 2 veces
   2  src/app/components/sidebar.tsx
```

Cada arreglo hay que hacerlo dos veces y en la práctica solo se hace en el estático
— por eso el hallazgo 02 lleva vivo sin que nadie lo note. El README dice lo
contrario de lo que dicen los commits.

**Arreglo:** es decisión de producto. Elegir cuál de las dos es la aplicación.

### 11 — BAJO · Sin CI, sin pruebas y sin protección de rama

No existe `.github/`. `package.json` no define script de test. `main` figura como
`protected: false` y recibe pushes directos; los tres PR se abrieron y cerraron el
mismo día en intervalos de ocho segundos, sobre la misma rama.

Un workflow con `npm ci`, `npm run lint`, `tsc --noEmit` y `npm run build` (con env
ficticias) habría detectado los hallazgos 03 y 04 el día que aparecieron.

### 12 — BAJO · El README describe una estructura que ya no existe

Documenta `src/lib/supabase.ts`, que no existe (el cliente está en
`src/utils/supabase/client.ts`). El árbol no lista `src/app/components/`,
`src/modules/manychat/` ni las páginas de `pendientes`, `cotizaciones` y `manychat`,
y llama a `control-roas` «el módulo activo» cuando ya hay cuatro.

---

## Dependencias

### 13 — BAJO · Todo el stack una versión menor por detrás

| Paquete | Actual | Última | Nota |
|---|---|---|---|
| `next` | 16.2.3 | 16.3.4 | fijado, subir a mano |
| `eslint-config-next` | 16.2.3 | 16.3.4 | fijado, va con `next` |
| `@supabase/supabase-js` | 2.105.3 | 2.112.4 | cubierto por `^` |
| `react` / `react-dom` | 19.2.4 | 19.2.8 | fijado |
| `recharts` | 3.8.1 | 3.10.1 | cubierto por `^` |
| `tailwindcss` | 4.2.2 | 4.3.3 | cubierto por `^` |
| `typescript` | 5.9.3 | 7.0.2 | salto mayor, no urgente |

---

## Qué se ejecutó

| Comprobación | Resultado | Detalle |
|---|---|---|
| `npm install` | OK | exit 0 |
| `eslint .` | OK | exit 0, cero avisos |
| `tsc --noEmit` | OK | exit 0, cero `any` |
| `next build` sin env | Falla | exit 1 — `supabaseUrl is required` (03) |
| `next build` con env | OK | 5 rutas prerenderizadas |
| Render Chromium 1440×900 | Defecto | solape del sidebar medido (02) |
| Rutas del menú | Defecto | `/utm-builder` → 404 (04) |
| Revisión de políticas RLS | Defecto | 6 políticas admiten `anon` (01) |
| Historial y ramas | Defecto | sin ancestro común (09) |
| Estado del repo en GitHub | Leído | público, 2 ramas, 3 PR cerrados, sin Actions |
| Acceso `anon` real a Supabase | No ejecutada | salida de red bloqueada |
| GitHub Pages en vivo | No ejecutada | salida de red bloqueada |
| Pruebas automatizadas | No existen | el proyecto no define ninguna (11) |

---

## Orden recomendado

1. **Cerrar el `anon` en las seis políticas RLS.** Único hallazgo con exposición
   externa, seis líneas de SQL. Confirmar antes si la escritura anónima funciona.
2. **Desplazar el `<main>` el ancho del sidebar.** Afecta a todas las páginas con datos.
3. **Añadir `.env.example` y un workflow de CI.** Cierra 03, 04 y 12 a futuro.
4. **Quitar o construir `/utm-builder`.**
5. **Decidir entre `index.html` y la app Next.** No urgente hoy; lo que más ahorra
   a partir del mes que viene.
6. **Llevar Cotizaciones a Supabase** y etiquetar ManyChat como demo.
7. **Etiquetar y archivar la rama `codex`.**
