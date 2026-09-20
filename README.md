# LR Suite

LR Suite es una aplicación operativa para gestión financiera, comercial y de performance. El proyecto combina una app Next.js con Supabase y un `index.html` estático de acceso rápido.

## Estructura Principal

```txt
src/
  app/
    layout.tsx
    page.tsx
    globals.css
  lib/
    supabase.ts
  modules/
    control-roas/
      BBDD/
      types.ts
      utils.ts
    estado-perdidas-ganancias/
      BBDD/
    seguimiento-cotizaciones/
      BBDD/
    lista-pendientes/
      BBDD/
```

## Módulos

### `control-roas`

Módulo activo de la app Next.js. Gestiona registros ROAS, costos, empresas, workspaces, miembros del equipo, filtros y reportes.

### `estado-perdidas-ganancias`

Módulo financiero de LR Suite. Su documentación de datos está preparada para llevar las estructuras del `index.html` estático a componentes Next.

### `seguimiento-cotizaciones`

Módulo comercial para controlar cotizaciones por cliente, estado, monto, probabilidad, responsable y próximo seguimiento.

### `lista-pendientes`

Módulo operativo para seguimiento de tareas, prioridades, responsables, vencimientos y estados.

### `utm-builder`

Generador de URLs con parámetros UTM para campañas.

### `clientes`

Tablero de accesos. Reúne todos los proyectos de GitHub del equipo con su enlace al dashboard publicado en GitHub Pages y a su repositorio, agrupados por cliente. El catálogo vive en `src/modules/clientes/data.ts`.

### `manychat`

Módulo retirado de la navegación. Sus componentes se conservan en `src/modules/manychat` para retomarlos en el futuro; ya no existe la ruta `/manychat`.

## Carpeta `BBDD`

Cada módulo tiene su propia carpeta `BBDD`. Su finalidad es centralizar:

- Esquemas de tablas.
- Diccionarios de campos.
- SQL o migraciones.
- Datos demo.
- Notas de Supabase.
- Decisiones de modelo de datos.

Esto evita que la información generada por cada módulo quede dispersa o se pierda.

## Archivos Importantes

- `src/app/page.tsx`: pantalla principal actual. Sigue concentrando la UI del módulo `control-roas`, pero ahora consume tipos y utilidades desde `src/modules/control-roas`.
- `src/lib/supabase.ts`: cliente compartido de Supabase.
- `src/modules/control-roas/types.ts`: tipos principales del módulo activo.
- `src/modules/control-roas/utils.ts`: helpers de fechas, moneda, ROAS y errores Supabase.
- `index.html`: versión estática autónoma de LR Suite para abrir en navegador sin servidor local.

## Limpieza Realizada

- Se centralizó el cliente Supabase fuera de `src/app`.
- Se separaron tipos y utilidades repetibles del módulo ROAS.
- Se creó `src/modules` con carpeta `BBDD` por módulo.
- Se eliminaron assets SVG de plantilla de Next que no estaban siendo usados.
- Se documentó la estructura modular esperada.

## Comandos

```bash
npm run dev
npm run build
npm run lint
```

