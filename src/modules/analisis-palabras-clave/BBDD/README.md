# BBDD - Análisis de Palabras Clave

El módulo usa la tabla `lr_suite_private_data` (RLS: solo usuarios de LR Suite). No crea tablas nuevas.

## Archivos

- `sincronizacion-drive.sql`: funciones de listado y descarga, sincronización diaria (pg_cron, 06:20 Lima),
  RPC `list_lr_suite_keyword_files()` del botón "Actualizar" y configuración de la carpeta. Ejecutarlo
  completo en Supabase > SQL Editor (es idempotente) y después `lr_suite_keywords_set_folder('<ID>')`.

## Filas

### `keywords-config`

```json
{ "folderId": "<ID de la carpeta de Drive>" }
```

Se escribe con `lr_suite_keywords_set_folder()`. Es lo único que guarda el ID de la carpeta.

### `keywords-status` (~4 KB, se reescribe en cada sincronización)

```json
{
  "schemaVersion": 1,
  "source": "Google Drive · Informes de palabras clave de Google Ads",
  "folderId": "…",
  "discovery": "drive-api | embeddedfolderview | manifest",
  "lastSync": "2026-10-05T11:20:03.120+00:00",
  "lastChange": "2026-10-04T11:20:02.871+00:00",
  "trigger": "automatica | manual | instalacion",
  "requestedBy": null,
  "contentHash": "md5 de id|nombre|csv de cada informe",
  "changed": false,
  "files": [{ "id": "…", "name": "Lima Retail Google Ads Setiembre 2026",
              "mimeType": "application/vnd.google-apps.spreadsheet", "modifiedTime": "10:12 pm",
              "status": "ok | anterior | error" }],
  "errors": []
}
```

### `keywords` (~75 KB por mes, solo se reescribe si cambió `contentHash`)

```json
{
  "schemaVersion": 1,
  "contentHash": "…",
  "lastChange": "…",
  "files": [{ "id": "…", "name": "…", "mimeType": "…", "csv": "<informe crudo>" }]
}
```

El CSV se guarda crudo (incluidas las campañas excluidas): el `index.html` lo interpreta con
`../keyword-report.js` y aplica ahí las exclusiones. `modifiedTime` llega como ISO con Drive API y como texto
("10:12 pm", "3 oct") con la vista pública; por eso no entra en el hash.

## Egress (plan gratuito)

Al abrir el módulo se lee `keywords-status`. `keywords` se descarga solo cuando cambió el contenido y es más
reciente que la caché del navegador (IndexedDB): como mucho una vez al día por navegador. El botón
"Actualizar" descarga las hojas directo de Google y a Supabase solo le pide la lista de archivos.
