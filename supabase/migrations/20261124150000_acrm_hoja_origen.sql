-- El origen de un prospecto de la hoja: la hoja manda sobre el Connections.csv.
--
-- Un prospecto con perfil se guarda con la clave «li:<url>», la misma que usan los contactos que
-- entraron por el Connections.csv. Cuando la hoja de prospección trae a alguien que ya estaba ahí,
-- el ON CONFLICT rellenaba sus huecos pero dejaba el canal en 'linkedin': la ficha quedaba completa
-- y con sus datos de la hoja, pero no salía al filtrar «Ads Library» en la Tabla Maestra. El 24 de
-- noviembre de 2026 eran 22 de las 265 filas de la hoja, y por eso el filtro marcaba 247.
--
-- Desde acá, una fila de la hoja pasa esa ficha a 'ads_library': lo que la hoja dice de dónde viene
-- un prospecto manda sobre el origen que tenía por estar en la agenda de alguien. No se pierde nada:
-- quién lo tiene en su Connections.csv se lee de lr_pros_contactos_propios, no del canal, así que la
-- tabla sigue diciendo de quién es la agenda.
--
-- Solo se reescribe 'linkedin'. Un lead de 'meta_whatsapp' o 'directo' existe porque esa persona
-- escribió ella: eso es un hecho de la conversación, no una lista, y una hoja no lo cambia. En la
-- práctica tampoco chocan nunca —sus claves son 'wa:…' y las de cotización—, así que la regla es
-- sobre todo una promesa escrita.
--
-- Para que los que ya están se pongan al día: después de aplicar esta migración, «Volver a traer
-- todo» en el panel «+ Prospectos de la hoja» (o select private.lr_pros_hoja_sincronizar(true)).
BEGIN;

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
  -- El que ya estaba por su Connections.csv pasa a ser un prospecto de la hoja: es lo que explica
  -- por qué está en la lista. Los demás orígenes no se tocan.
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

COMMIT;
