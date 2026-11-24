-- El identificador interno de LinkedIn no es un perfil.
--
-- Al copiar el enlace de alguien desde Sales Navigator o desde la API, LinkedIn da una dirección del
-- tipo «linkedin.com/in/ACoAAA3yVp8B…»: su identificador interno, no la dirección pública. Ese id
-- distingue mayúsculas y acá las claves se guardan en minúsculas, así que el enlace nace roto —las
-- cinco fichas que entraron así el 23/11/2026 llevaban a la página 404 de LinkedIn— y, como la clave
-- de un lead es su URL, la misma persona vuelve a entrar como un lead distinto el día que llega con
-- su dirección de verdad.
--
-- Desde acá no entra:
--   · private.lr_acrm_prospecto_guardar lo rechaza con un mensaje que dice qué hace falta. Es el
--     alta de uno en uno, donde alguien pegó ese enlace a propósito y tiene que enterarse.
--   · private.lr_acrm_prospecto_hoja lo deja en blanco, como ya hace con el texto «Abrir perfil»:
--     el prospecto de la hoja entra igual, sin perfil, y nadie pierde una empresa por una URL.
-- El navegador hace lo mismo en perfilLinkedin (acrm-leads.js), así que la hoja pegada a mano y la
-- descargada se comportan igual.
--
-- Las cinco fichas que ya habían entrado se renombraron a mano el 24/11/2026 con su dirección
-- pública (private/corregir-urls-acoaa.local.sql, fuera del repositorio).
BEGIN;

-- ── El alta de un prospecto: rechaza el id interno ─────────────────────────
CREATE OR REPLACE FUNCTION private.lr_acrm_prospecto_guardar(p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_perfil text; v_web text; v_dominio text; v_clave text; v_nombre text; v_empresa text;
 v_existe boolean; v_previo text;
BEGIN
 v_nombre:=left(btrim(coalesce(p_datos->>'nombre','')),300);
 v_empresa:=left(btrim(coalesce(p_datos->>'empresa','')),200);
 v_web:=regexp_replace(btrim(coalesce(p_datos->>'web','')),'/+$','');
 IF v_web<>'' AND v_web !~* '^https?://' THEN v_web:='https://'||v_web; END IF;
 v_dominio:=split_part(lower(regexp_replace(v_web,'^https?://(www\.)?','','i')),'/',1);
 v_perfil:=lower(btrim(coalesce(p_datos->>'linkedin','')));
 IF v_perfil<>'' AND v_perfil !~ '^https://www\.linkedin\.com/in/[a-z0-9][a-z0-9_.%-]{1,180}$' THEN
  RAISE EXCEPTION 'El perfil tiene que ser una URL de linkedin.com/in/…: %',v_perfil;
 END IF;
 -- El id interno (ACoAAA…) pasa el formato de arriba pero no lleva a ninguna parte.
 IF v_perfil ~ '^https://www\.linkedin\.com/in/acoaa[a-z0-9_-]{20,}$' THEN
  RAISE EXCEPTION 'Ese enlace es el identificador interno de LinkedIn y no abre el perfil: hace falta su dirección pública (linkedin.com/in/nombre-apellido): %',v_perfil;
 END IF;
 IF v_perfil<>'' THEN
  v_clave:='li:'||v_perfil;
 ELSE
  -- Las tildes se van antes de armar la clave: «Hernández» y «Hernandez» no son dos prospectos.
  IF v_dominio='' THEN v_dominio:=btrim(regexp_replace(private.lr_pros_titulo(v_empresa),'[^a-z0-9]+','-','g'),'-'); END IF;
  IF v_dominio='' THEN RAISE EXCEPTION 'Un prospecto necesita al menos su dominio o el nombre de la empresa'; END IF;
  v_clave:='ads:'||left(v_dominio,400);
  IF v_nombre<>'' THEN
   SELECT x.nombre INTO v_previo FROM public.lr_acrm_capturas x
    JOIN public.lr_acrm_embudo e ON e.captura=x.clave
    WHERE x.clave=v_clave AND x.canal='ads_library' AND e.etapa='nuevo'
      AND x.nombre IN (v_empresa,v_dominio);
   IF v_previo IS NULL THEN
    v_clave:=left(v_clave||'-'||btrim(regexp_replace(private.lr_pros_titulo(v_nombre),'[^a-z0-9]+','-','g'),'-'),480);
   END IF;
  END IF;
 END IF;
 IF coalesce(nullif(v_nombre,''),nullif(v_empresa,''),v_dominio)='' THEN
  RAISE EXCEPTION 'Un prospecto necesita al menos su nombre, su empresa o su dominio';
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.lr_acrm_capturas WHERE clave=v_clave) INTO v_existe;
 INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en,consulta,rubro,empresa,web)
 VALUES(v_clave,'ads_library',
  coalesce(nullif(v_nombre,''),nullif(v_empresa,''),v_dominio),
  now(),
  left(btrim(coalesce(p_datos->>'consulta','')),2000),
  left(btrim(coalesce(p_datos->>'rubro','')),120),
  v_empresa,
  left(v_web,300))
 ON CONFLICT(clave) DO UPDATE SET
  -- El que ya estaba por su Connections.csv pasa a ser un prospecto de la hoja (20261124150000).
  canal=CASE WHEN lr_acrm_capturas.canal='linkedin' THEN 'ads_library' ELSE lr_acrm_capturas.canal END,
  nombre=CASE WHEN v_nombre<>'' AND lr_acrm_capturas.nombre IN ('',v_empresa,v_dominio)
              THEN v_nombre ELSE lr_acrm_capturas.nombre END,
  consulta=CASE WHEN lr_acrm_capturas.consulta='' THEN excluded.consulta ELSE lr_acrm_capturas.consulta END,
  rubro=CASE WHEN lr_acrm_capturas.rubro='' THEN excluded.rubro ELSE lr_acrm_capturas.rubro END,
  empresa=CASE WHEN lr_acrm_capturas.empresa='' THEN excluded.empresa ELSE lr_acrm_capturas.empresa END,
  web=CASE WHEN lr_acrm_capturas.web='' THEN excluded.web ELSE lr_acrm_capturas.web END;
 RETURN jsonb_build_object('ok',true,'clave',v_clave,'nuevo',NOT v_existe);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_prospecto_guardar(jsonb) FROM PUBLIC,anon,authenticated;

-- ── La hoja: el id interno es como «Abrir perfil», no un error ─────────────
CREATE OR REPLACE FUNCTION private.lr_acrm_prospecto_hoja(p_texto text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
 v_linea text; v_celdas text[]; v_campo text; v_titulo text;
 v_mapa jsonb:='{}'::jsonb; v_cabecera boolean:=false;
 v_datos jsonb; v_salida jsonb; v_cargo text; v_pregunta text; v_consulta text; v_url text;
 v_filas int:=0; v_nuevos int:=0; v_repetidos int:=0; v_errores jsonb:='[]'::jsonb;
 i int;
BEGIN
 FOREACH v_linea IN ARRAY string_to_array(replace(coalesce(p_texto,''),E'\r',''),E'\n') LOOP
  IF btrim(v_linea)='' THEN CONTINUE; END IF;
  v_celdas:=string_to_array(v_linea,E'\t');
  -- La fila de títulos: la primera con alguna columna reconocible. Una segunda fila de títulos
  -- (pasa al pegar dos trozos de la hoja) se salta más abajo.
  IF NOT v_cabecera THEN
   FOR i IN 1..array_length(v_celdas,1) LOOP
    v_titulo:=private.lr_pros_titulo(v_celdas[i]);
    v_campo:=private.lr_pros_campo(v_celdas[i]);
    IF v_campo IS NULL THEN CONTINUE; END IF;
    -- La primera columna de cada campo manda, salvo «URL del perfil», que es la buena para el
    -- perfil aunque «Perfil LinkedIn» venga antes.
    IF NOT v_mapa ? v_campo OR v_titulo='url del perfil' THEN
     v_mapa:=v_mapa||jsonb_build_object(v_campo,i);
    END IF;
   END LOOP;
   IF v_mapa ? 'empresa' OR v_mapa ? 'web' OR v_mapa ? 'nombre' THEN
    v_cabecera:=true;
   ELSE
    v_mapa:='{}'::jsonb;
   END IF;
   CONTINUE;
  END IF;
  -- Una fila cuyos valores son los propios títulos no es un prospecto.
  IF private.lr_pros_campo(v_celdas[(v_mapa->>'empresa')::int]) IS NOT NULL THEN CONTINUE; END IF;
  v_datos:='{}'::jsonb;
  FOR v_campo IN SELECT jsonb_object_keys(v_mapa) LOOP
   i:=(v_mapa->>v_campo)::int;
   v_datos:=v_datos||jsonb_build_object(v_campo,btrim(coalesce(v_celdas[i],'')));
  END LOOP;
  -- El cargo publicado y la pregunta comercial son lo que se sabe del prospecto antes de escribirle:
  -- van juntos en la consulta, que es lo que la tabla enseña bajo su nombre.
  v_cargo:=coalesce(v_datos->>'cargo','');
  v_pregunta:=coalesce(v_datos->>'pregunta','');
  v_consulta:=btrim(concat_ws(' · ',nullif(v_cargo,''),nullif(v_pregunta,'')));
  v_datos:=v_datos||jsonb_build_object('consulta',v_consulta);
  -- Lo que la hoja trae en «Perfil LinkedIn» cuando no hay columna de URL es el texto del enlace
  -- («Abrir perfil»): eso no es un perfil y el prospecto entra sin él.
  IF coalesce(v_datos->>'linkedin','') !~* '^https?://([a-z]{2,3}\.)?(www\.)?linkedin\.com/in/' THEN
   v_datos:=v_datos||jsonb_build_object('linkedin','');
  ELSE
   -- Normalizada igual que en el navegador (perfilLinkedin): sin país, sin parámetros, sin ancla y
   -- sin lo que venga después del identificador. Lo último importa: la hoja trae perfiles copiados
   -- en otro idioma («…/in/renzo-ibanez/en»), que son la misma persona y, sin recortar, ni entran.
   v_url:=lower(split_part(split_part(btrim(v_datos->>'linkedin'),'?',1),'#',1));
   v_url:=regexp_replace(v_url,'^https?://([a-z]{2,3}\.|www\.)?linkedin\.com/','https://www.linkedin.com/');
   v_url:=regexp_replace(v_url,'^(https://www\.linkedin\.com/in/[^/]+).*$','\1');
   -- El id interno de LinkedIn (ACoAAA…) tampoco es un perfil: el prospecto entra sin él, igual que
   -- con «Abrir perfil», en vez de nacer con un enlace que lleva al 404 (20261124180000).
   IF v_url ~ '^https://www\.linkedin\.com/in/acoaa[a-z0-9_-]{20,}$' THEN v_url:=''; END IF;
   v_datos:=v_datos||jsonb_build_object('linkedin',v_url);
  END IF;
  IF coalesce(v_datos->>'empresa','')='' AND coalesce(v_datos->>'web','')=''
     AND coalesce(v_datos->>'nombre','')='' THEN CONTINUE; END IF;
  v_filas:=v_filas+1;
  BEGIN
   v_salida:=private.lr_acrm_prospecto_guardar(v_datos);
   IF (v_salida->>'nuevo')::boolean THEN v_nuevos:=v_nuevos+1; ELSE v_repetidos:=v_repetidos+1; END IF;
  EXCEPTION WHEN others THEN
   IF jsonb_array_length(v_errores)<20 THEN
    v_errores:=v_errores||jsonb_build_object(
     'empresa',coalesce(v_datos->>'empresa',''),'nombre',coalesce(v_datos->>'nombre',''),'motivo',SQLERRM);
   END IF;
  END;
 END LOOP;
 IF NOT v_cabecera THEN
  RAISE EXCEPTION 'La hoja no trae su fila de títulos (Empresa, Dominio clave, Nombre público…)';
 END IF;
 RETURN jsonb_build_object('ok',true,'filas',v_filas,'nuevos',v_nuevos,'repetidos',v_repetidos,
  'errores',v_errores,'columnas',(SELECT coalesce(jsonb_agg(k ORDER BY k),'[]'::jsonb) FROM jsonb_object_keys(v_mapa) k));
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_prospecto_hoja(text) FROM PUBLIC,anon,authenticated;

COMMIT;
