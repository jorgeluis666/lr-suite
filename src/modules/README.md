# Módulos

Cada carpeta dentro de `src/modules` representa un módulo funcional independiente.

## Reglas

- Los archivos de un módulo deben vivir dentro de su carpeta.
- Cada módulo debe incluir una carpeta `BBDD`.
- `BBDD` documenta tablas, esquemas, datos demo, migraciones y decisiones de base de datos del módulo.
- La lógica compartida entre módulos debe vivir en `src/lib` o en componentes compartidos, no duplicada dentro de cada módulo.

## Módulos actuales

- `control-roas`: módulo activo de dashboard ROAS, costos, empresas, workspaces y equipo.
- `estado-perdidas-ganancias`: módulo financiero de LR Suite, actualmente documentado para migración desde `index.html`.
- `seguimiento-cotizaciones`: módulo comercial de cotizaciones, actualmente documentado para migración desde `index.html`.
- `lista-pendientes`: módulo operativo de tareas, actualmente documentado para migración desde `index.html`.

