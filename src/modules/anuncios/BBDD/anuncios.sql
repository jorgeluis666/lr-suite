-- ============================================================================
-- Anuncios por marca y mes (clave "ads") · plantilla
--
-- Los anuncios ya sumados y los ids de sus piezas de Drive viven en una fila de
-- lr_suite_private_data, que solo leen los usuarios de la suite. No van en este repositorio,
-- que es publico: un id deja ver que marcas atiende la agencia y como esta armado su Drive.
--
-- El modulo "Anuncios" del index.html la lee despues del login (loadPrivateAds).
--
-- Forma del payload:
--   {
--     "version": 1,
--     "updatedAt": "<ISO>",
--     "moneda": "PEN",
--     "marcas": [{
--       "marca": "<marca>",
--       "meses": [{
--         "mes": "2026-10",
--         "etiqueta": "Octubre 2026",
--         "hoja": "<url del export de Meta Ads>",
--         "artes": "<url de la carpeta 06 Artes>",
--         "anuncios": [{
--           "nombre": "<Nombre del anuncio, tal cual el export>",
--           "campana": "...", "conjunto": "...", "tipoResultado": "...",
--           "desde": "2026-10-01", "hasta": "2026-10-15",
--           "gasto": 0, "impresiones": 0, "clics": 0, "interacciones": 0,
--           "compras": 0, "ingresos": 0, "conversaciones": 0, "resultados": 0,
--           "preview": "<enlace de vista previa de Meta>",
--           "creativo": null
--             -- pieza unica:  {"tipo": "video"|"imagen", "nombre": "...", "archivoId": "<id>"}
--             -- carrusel:     {"tipo": "carrusel", "nombre": "... (Carrusel)", "carpetaId": "<id>",
--             --                "laminas": ["<id>", "<id>"], "ordenIncierto": true}
--         }]
--       }]
--     }]
--   }
--
-- "creativo": null es un anuncio sin pieza en Drive; el modulo lo muestra igual, con sus numeros.
-- "ordenIncierto": true hace que la tarjeta avise de que el orden de las laminas no esta confirmado.
--
-- Ejecutar en Supabase > SQL Editor. Es idempotente: vuelve a escribir la fila entera.
-- ============================================================================

insert into public.lr_suite_private_data (key, payload, updated_at)
values ('ads', '<el JSON de arriba>'::jsonb, now())
on conflict (key) do update
  set payload = excluded.payload,
      updated_at = excluded.updated_at;

-- Comprobacion (no muestra los anuncios):
--   select key,
--          jsonb_array_length(payload -> 'marcas') as marcas,
--          payload ->> 'updatedAt' as generado,
--          updated_at
--   from public.lr_suite_private_data where key = 'ads';
