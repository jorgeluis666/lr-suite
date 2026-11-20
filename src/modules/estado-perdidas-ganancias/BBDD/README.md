# Pérdidas y Ganancias: fuentes de datos

El módulo está en `index.html`; `../financial-sources.js` integra la inversión de Nexus.
Los datos se leen después del login, bajo las políticas existentes de
`public.lr_suite_private_data`. No se añaden credenciales al navegador.

## Tabla madre

`sincronizacion-google-sheets.sql` instala la descarga CSV, la RPC
`sync_lr_suite_financial` y el cron diario a las 06:00 de Lima. El botón
«Actualizar datos» sincroniza la hoja y vuelve a leer los informes guardados por Nexus.
No ejecuta una extracción nueva de las APIs publicitarias.

| Pestaña | gid | Datos |
| --- | --- | --- |
| Ventas | 260930101 | Facturación acumulada, fechas y ventas. |
| Inversion | 260930102 | Inversión histórica consolidada y tipo de cambio. |
| Venta vs Resultados | 260930103 | Monto cotizado mensual, notas y conteos de respaldo. |
| Cotizaciones | 1153441758 | Exclusivamente rango A2:B: Fecha y Mes. |

Cotizaciones se exporta con el rango nativo de Sheets: GViz pierde algunas fechas
cuando la columna mezcla fechas y texto. Se valida el encabezado exacto antes de
reemplazar la copia anterior; teléfonos, correos y nombres no se descargan de esa pestaña.
Una fila cuenta como una cotización. Las filas sin fecha válida se cuentan por Mes,
pero no se asignan a un día. El detalle avisa cuántas no tienen fecha.

Los conteos de esta pestaña tienen prioridad sobre la plantilla y el CRM.
El monto cotizado se conserva de Venta vs Resultados. Las ventas anuladas, canceladas,
perdidas o devueltas no entran en facturación. Una descarga fallida conserva el snapshot anterior.

## Nexus

Se leen `gasto-alertas`, `gasto-status` y `financial-sources` junto a `financial`.
La configuración privada `financial-sources.payload.nexusAccounts` contiene arrays de
IDs exactos de cuentas por plataforma (`google`, `meta`). No se seleccionan cuentas
por nombres ni se incluyen clientes de la agencia. Los IDs reales se configuran en
Supabase, no se publican en el repositorio.

Para cada mes, se usa `informes[mes].cuentas`: `costeConvertido` si la moneda convertida
es PEN; de lo contrario, `coste` solo cuando su moneda es PEN. No se asume un tipo de
cambio. Cuentas ausentes, duplicadas o importes sin conversión quedan sin dato.
El campo `diario` de Nexus es presupuesto y **no** se interpreta como gasto diario.

Nexus tiene prioridad sobre los informes históricos de Drive y las cargas manuales
en los meses que reporta. El histórico de Drive sigue aportando meses anteriores.
Para el acumulado, el importe de un rango de la tabla madre se conserva hasta tener
todos sus meses desglosados; se suman únicamente los meses fuera de ese rango.
Así no se pierde el histórico ni se suma dos veces un mes parcialmente cubierto.
Las plataformas o meses faltantes se muestran como inversión parcial.

La ventana `gasto-status.ventanas[plataforma]` se usa solo si corresponde al mes
consultado; para otros meses se usa la ventana del informe. El corte está visible.
`sincronizacion-meta-ads.sql` queda como mecanismo anterior: el botón de este módulo
ya no llama a esa RPC. Nexus mantiene su sincronización existente.

## Vista y verificación

La izquierda muestra Google Ads diario estimado, leads de la plantilla o cotizaciones
fechadas. El reparto estimado del gasto Nexus se limita a su ventana reportada y
cuadra al céntimo; los días posteriores quedan vacíos. La derecha conserva cuatro
gráficos mensuales en cuadrícula 2 × 2. En móvil los bloques se apilan.

Leads no tiene fuente automática conectada: se conservan las cargas comerciales y
no se inventan ceros. El gasto histórico sin desglose no se distribuye entre meses.
Resultado = facturación − inversión; ROAS = facturación / inversión.

Verificaciones: `node scripts/check-index.js` y `node --test tests/financial/monthly.cjs`.
Las pruebas incluyen separación de cuentas, moneda, cobertura, conservación del
histórico, duplicados, fechas inválidas y conciliación diaria/mensual.
