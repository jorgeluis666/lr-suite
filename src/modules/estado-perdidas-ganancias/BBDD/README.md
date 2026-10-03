# BBDD - Estado de Pérdidas y Ganancias

El módulo vive en el `index.html` estático. Sus datos salen de la hoja de Google
**"Perdidas y ganancias - Lima Retail"** (dueño: diegomachuca@limaretail.com).

## Archivos

- `sincronizacion-google-sheets.sql`: extensiones `http` y `pg_cron`, funciones de descarga, RPC del
  botón "Actualizar" y cron diario. Ejecutarlo completo en Supabase > SQL Editor (es idempotente).

## Flujo

```txt
Google Sheets ──(CSV por pestaña)──> Supabase: lr_suite_financial_refresh()
                                       │  pg_cron "lr-suite-financial-daily": 06:00 Lima (11:00 UTC)
                                       │  RPC sync_lr_suite_financial(): botón "Actualizar"
                                       ▼
                        lr_suite_private_data, clave "financial"
                                       │  1 lectura (~5 KB) al iniciar sesión
                                       ▼
                        index.html: interpreta el CSV y arma el estado
```

- La descarga la hace la base de datos, no el navegador: el ID de la hoja no aparece en el `index.html`
  público y la fila solo la leen Jorge Luis y Diego (RLS de `lr_suite_private_data`).
- Si Google no devuelve el CSV esperado (hoja dejó de ser pública, pestaña reemplazada), la función
  falla y se conservan los datos anteriores. El botón muestra el motivo.
- Si la última actualización tiene más de 30 horas, el módulo muestra un aviso para revisar el cron.
- Requisito: la hoja debe seguir compartida como "Cualquier persona con el enlace: Lector".

## Pestañas que se leen

| Pestaña | gid | Uso |
| --- | --- | --- |
| Ventas | 260930101 | Ingresos: una línea por venta (`Facturación acumulada`, o `Monto base × Meses`). |
| Inversion | 260930102 | Inversión publicitaria consolidada por plataforma (`Inversión en PEN`). |
| Venta vs Resultados | 260930103 | Cotizaciones y monto cotizado por mes, observaciones y notas. |

**Cotizaciones**, **Resumen** y **Fuera de periodo** no se descargan (Cotizaciones tiene teléfonos y
correos de prospectos).

El `index.html` ubica cada tabla por la primera celda de su fila de encabezados (`Fecha`,
`Plataforma`, `Mes`) y lee las columnas por nombre, así que se pueden agregar filas, columnas o notas.
Renombrar un encabezado usado o mover una pestaña a otra hoja sí requiere ajustar el código o el SQL.

## Cálculos

- **Facturación** de un periodo: suma de las ventas de la pestaña Ventas cuya fecha cae en él. Las
  ventas con estado anulada/cancelada/perdida/devuelta no se cuentan.
- **Inversión publicitaria**: en el Acumulado, total de la pestaña Inversion (Meta + Google en soles).
  Por mes solo existe si se llena la columna `Inversión (S/)` de Venta vs Resultados; no se reparte
  para no inventar cifras (la propia hoja lo indica en su "Nota de inversión").
- **Resultado** = facturación − inversión publicitaria. **Margen** = resultado / facturación.
  **ROAS** = facturación / inversión.
- **Tasa de cierre** = ventas del periodo / cotizaciones del periodo.

## Payload guardado (`lr_suite_private_data.payload`, clave `financial`)

```json
{
  "source": "Google Sheets · Perdidas y ganancias - Lima Retail",
  "syncedAt": "2026-10-02T11:00:04.512+00:00",
  "trigger": "automatica | manual | instalacion",
  "requestedBy": "correo de quien pulsó Actualizar, o null",
  "tabs": { "ventas": "<csv>", "inversion": "<csv>", "resultados": "<csv>" }
}
```

## Mantenimiento

- Ver la última sincronización y las ejecuciones del cron: consultas al final del SQL.
- Cambiar la hora del cron: `cron.schedule('lr-suite-financial-daily', '<cron UTC>', ...)` (ver SQL).
- Si se agrega una pestaña nueva, sumar su gid en `lr_suite_financial_refresh()` y su lectura en
  `buildFinancialModel()` del `index.html`.
