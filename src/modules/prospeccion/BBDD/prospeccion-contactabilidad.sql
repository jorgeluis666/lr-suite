-- ============================================================================
-- Prospección: contactabilidad (fechas de contacto y temas enviados)
-- Proyecto: brfsipssqfsuoplxxcth
--
-- Agrega a lr_suite_prospectos la columna «contactos»: la lista de contactos
-- hechos a cada perfil, como [{ "fecha": "AAAA-MM-DD", "tema": "..." }]. El
-- módulo «Prospección» la usa para el calendario de contactabilidad.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente y no toca los
-- datos existentes (todos los perfiles arrancan con la lista vacía).
-- ============================================================================

alter table public.lr_suite_prospectos
  add column if not exists contactos jsonb not null default '[]'::jsonb;

-- Sin este aviso la API puede seguir respondiendo con el esquema anterior y
-- rechazar la columna nueva.
notify pgrst, 'reload schema';

-- Comprobación: debe devolver contactos | jsonb.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'lr_suite_prospectos' and column_name = 'contactos';
