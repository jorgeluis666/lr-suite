# BBDD - Análisis de Palabras Clave

El módulo usa la tabla `lr_suite_private_data` (RLS: solo usuarios de LR Suite). No crea tablas nuevas.

## Archivos

- `sincronizacion-drive.sql`: funciones de listado y descarga, sincronización diaria por marca (pg_cron,
  06:20 Lima), RPC `list_lr_suite_keyword_files(<marca>)` del botón "Actualizar" y alta de marcas.
  Ejecutarlo completo en Supabase > SQL Editor (es idempotente) y después una línea por marca con
  `lr_suite_keywords_set_marca('<id>', '<Nombre>', '<ID_DE_LA_CARPETA>')`.

## Filas

Una marca es una cuenta de Google Ads con su carpeta de informes, la que llena Nexus. La cuenta de la
agencia es `lima-retail` y conserva las claves de antes (`keywords`), porque de ella sale la inversión en
Google Ads de Pérdidas y Ganancias; las demás guardan en `keywords:<id>`.

### `keywords-config`

```json
{
  "folderId": "<ID de la carpeta de la agencia, el campo de la instalación anterior>",
  "marcas": [
    { "id": "lima-retail", "nombre": "Lima Retail", "folderId": "…", "agencia": true },
    { "id": "royal-baby", "nombre": "Royal Baby", "folderId": "…", "agencia": false }
  ]
}
```

Se escribe con `lr_suite_keywords_set_marca()` y se vacía con `lr_suite_keywords_quitar_marca()`. Es lo
único que guarda los ID de las carpetas. Una configuración vieja con solo `folderId` se lee como la marca
`lima-retail`, así que el módulo sigue funcionando antes de dar de alta nada.

### `keywords-status` (~4 KB, se reescribe en cada sincronización)

```json
{
  "schemaVersion": 2,
  "source": "Google Drive · Informes de palabras clave de Google Ads por marca",
  "lastSync": "2026-11-17T11:20:03.120+00:00",
  "trigger": "automatica | manual | instalacion",
  "requestedBy": null,
  "marcas": [{
    "id": "lima-retail", "nombre": "Lima Retail", "folderId": "…", "dataKey": "keywords", "agencia": true,
    "discovery": "drive-api | embeddedfolderview | manifest",
    "lastSync": "…", "lastChange": "…",
    "contentHash": "md5 de id|nombre|csv de cada informe", "changed": false,
    "files": [{ "id": "…", "name": "Lima Retail Google Ads Setiembre 2026",
                "mimeType": "application/vnd.google-apps.spreadsheet", "modifiedTime": "10:12 pm",
                "status": "ok | anterior | error" }],
    "errors": [], "error": "solo si esa marca falló entera"
  }],
  "errors": []
}
```

Los campos sueltos de la marca de la agencia (`folderId`, `discovery`, `contentHash`, `files`…) se repiten
arriba del todo a propósito: un navegador con el `index.html` anterior los lee de ahí y no se queda en
blanco el día del cambio.

### `keywords` y `keywords:<marca>` (~75 KB por mes, solo se reescriben si cambió su `contentHash`)

```json
{
  "schemaVersion": 1,
  "marca": "lima-retail",
  "contentHash": "…",
  "lastChange": "…",
  "files": [{ "id": "…", "name": "…", "mimeType": "…", "csv": "<informe crudo>" }]
}
```

El CSV se guarda crudo (incluidas las campañas excluidas): el `index.html` lo interpreta con
`../keyword-report.js` y aplica ahí las exclusiones. `modifiedTime` llega como ISO con Drive API y como texto
("10:12 pm", "3 oct") con la vista pública; por eso no entra en el hash.

## Egress (plan gratuito)

Al abrir el módulo se lee `keywords-status`, que pesa lo mismo con una marca que con doce. La fila grande se
descarga **solo la de la marca que se está mirando**, y solo cuando cambió el contenido y es más reciente que
la caché del navegador (IndexedDB): como mucho una vez al día por navegador y por marca que se visite. Las
marcas que nadie abre no se descargan nunca. El botón "Actualizar" descarga las hojas directo de Google y a
Supabase solo le pide la lista de archivos de esa marca.
