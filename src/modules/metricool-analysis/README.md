# Metricool Analysis

Módulo oculto de la navegación de LR Suite. Su código se retiró de `index.html` y se conserva aquí para reutilizarlo más adelante.

## Archivos

- `data.js`: reporte base integrado (periodo, KPIs, canales, top de contenidos y recomendaciones) y la clave de `localStorage`.
- `utils.js`: persistencia local del reporte cargado y lectura/parseo del PDF exportado desde Metricool (usa pdf.js desde CDN).
- `components/metricool-module.js`: render del módulo (`metricoolModule()`), entrada de navegación y línea de enrutado.
- `metricool-analysis.css`: estilos propios del módulo (`.metricool-*`, `.post-*`, `.bar-*`, `.recommendation*`).
- `BBDD/`: el módulo no usa base de datos.

## Dependencias de `index.html`

El código usa helpers que siguen en `index.html`: `icons`, `badge`, `escapeHtml`, `fmtDate`, `fmtNumber`, `fmtMetricPercent`, `render`, `shell`, `header`, `metric` y las clases compartidas (`.split`, `.compare-title`, `.control`, `.btn`).

## Reactivar

1. Copiar `data.js`, `utils.js` y `components/metricool-module.js` dentro del `<script>` principal de `index.html`.
2. Copiar `metricool-analysis.css` dentro del `<style>`.
3. Añadir la entrada `{ id: "metricool", ... }` al array `modules` y la rama `else if (state.active === "metricool") metricoolModule();` en `render()`.
