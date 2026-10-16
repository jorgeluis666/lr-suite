-- ============================================================================
-- Carpetas de Drive de cada marca (clave "clientes-drive") · plantilla
--
-- Las carpetas de Drive no se guardan en este repositorio, que es publico: un id de
-- carpeta deja ver que marcas atiende la agencia y como esta armado su Drive. Viven en
-- Supabase, en una fila de lr_suite_private_data, que solo leen los usuarios de la suite.
--
-- El modulo "Clientes" del index.html la lee despues del login (loadClientesDrive) y
-- busca cada carpeta por el nombre del repositorio, que es el id de la marca en
-- clientesProyectos. Una marca sin entrada pinta su acceso "Drive" en gris.
--
-- Esta es la plantilla, sin datos. El archivo con los ids reales es
-- private/clientes-drive-seed.local.sql, que esta en .gitignore.
--
-- Ejecutar en Supabase > SQL Editor. Es idempotente: vuelve a escribir la fila entera.
-- ============================================================================

insert into public.lr_suite_private_data (key, payload, updated_at)
values (
  'clientes-drive',
  jsonb_build_object(
    '<nombre del repo>', 'https://drive.google.com/drive/folders/<id de la carpeta>'
    -- una linea por marca
  ),
  now()
)
on conflict (key) do update
  set payload = excluded.payload,
      updated_at = excluded.updated_at;

-- Para agregar o cambiar una sola marca sin reescribir las demas:
--   update public.lr_suite_private_data
--   set payload = payload || jsonb_build_object('<nombre del repo>', '<url de la carpeta>'),
--       updated_at = now()
--   where key = 'clientes-drive';

-- Comprobacion (no muestra las urls):
--   select key, jsonb_object_keys(payload) as repo, updated_at
--   from public.lr_suite_private_data where key = 'clientes-drive';
