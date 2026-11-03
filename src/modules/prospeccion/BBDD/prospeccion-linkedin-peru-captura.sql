-- LR Suite · Captura asistida LinkedIn Perú (compartida entre usuarios autorizados).
-- Solo añade un endpoint SQL autenticado; conserva todas las tablas y demás módulos.
CREATE OR REPLACE FUNCTION public.lr_pros_registrar_linkedin_peru(p_registro jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth','pg_temp'
AS $fn$
DECLARE
 v_url text; v_nombre text; v_apellido text; v_empresa_nombre text; v_empresa_norm text;
 v_cargo text; v_ubicacion text; v_segmento text; v_web text; v_dominio text;
 v_empresa_id uuid; v_persona_id uuid; v_vinculo_id uuid; v_candidato_id uuid; v_lote_id uuid;
 v_result jsonb; v_name text; v_consent boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_lr_suite_pending_user() THEN
  RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_registro)<>'object' THEN RAISE EXCEPTION 'Registro inválido'; END IF;
 v_url:=public.lr_pros_linkedin_normalizada(p_registro->>'linkedin_url','in');
 IF v_url IS NULL THEN RAISE EXCEPTION 'Se requiere la URL exacta de un perfil LinkedIn /in/'; END IF;
 v_nombre:=nullif(btrim(p_registro->>'nombre'),'');
 v_apellido:=nullif(btrim(p_registro->>'apellido'),'');
 v_empresa_nombre:=nullif(btrim(p_registro->>'empresa'),'');
 v_cargo:=nullif(btrim(p_registro->>'cargo'),'');
 v_ubicacion:=nullif(btrim(p_registro->>'ubicacion'),'');
 v_segmento:=p_registro->>'segmento';
 v_web:=nullif(btrim(p_registro->>'web_empresa'),'');
 v_consent:=coalesce((p_registro->>'revisado_en_navegador')::boolean,false);
 IF v_nombre IS NULL OR length(v_nombre) NOT BETWEEN 2 AND 120
    OR v_apellido IS NULL OR length(v_apellido)>150
    OR v_empresa_nombre IS NULL OR length(v_empresa_nombre) NOT BETWEEN 2 AND 200
    OR v_cargo IS NULL OR length(v_cargo)>180
    OR v_ubicacion IS NULL OR length(v_ubicacion)>160
    OR v_segmento NOT IN ('retail_ecommerce','servicios_leads') THEN
   RAISE EXCEPTION 'Nombre, apellido, cargo, empresa, ubicación y segmento son obligatorios';
 END IF;
 IF lower(v_ubicacion) !~ '(^|[^[:alpha:]])per[uú]([^[:alpha:]]|$)' THEN
  RAISE EXCEPTION 'Solo se admiten perfiles cuya ubicación visible incluya Perú';
 END IF;
 IF NOT v_consent THEN RAISE EXCEPTION 'Confirma la revisión del perfil visible antes de registrarlo'; END IF;
 IF v_web IS NOT NULL AND (length(v_web)>1200 OR v_web !~* '^https?://[^[:space:]]+$') THEN
  RAISE EXCEPTION 'Web corporativa inválida';
 END IF;
 v_dominio:=public.lr_pros_dominio(v_web);
 v_empresa_norm:=regexp_replace(lower(v_empresa_nombre),'\s+',' ','g');

 -- Serializar capturas de ambos usuarios por URL canónica: mismo perfil, un único candidato.
 PERFORM pg_advisory_xact_lock(hashtextextended('lr-linkedin-peru:'||v_url,0));
 SELECT c.id INTO v_candidato_id
 FROM public.lr_pros_candidatos c
 JOIN public.lr_pros_personas p ON p.id=c.persona_id
 WHERE p.linkedin_url=v_url
 ORDER BY c.creado_en ASC LIMIT 1;
 IF v_candidato_id IS NOT NULL THEN
  RETURN jsonb_build_object('status','already_exists','candidate_id',v_candidato_id,'linkedin_url',v_url);
 END IF;

 SELECT id INTO v_empresa_id FROM public.lr_pros_empresas
 WHERE nombre_normalizado=v_empresa_norm AND dominio_normalizado IS NOT DISTINCT FROM v_dominio
 ORDER BY creado_en LIMIT 1;
 IF v_empresa_id IS NULL THEN
  INSERT INTO public.lr_pros_empresas(nombre,nombre_normalizado,segmento,web,dominio_normalizado)
  VALUES(v_empresa_nombre,v_empresa_norm,v_segmento,v_web,v_dominio)
  RETURNING id INTO v_empresa_id;
 END IF;
 SELECT id INTO v_persona_id FROM public.lr_pros_personas WHERE linkedin_url=v_url;
 IF v_persona_id IS NULL THEN
  INSERT INTO public.lr_pros_personas(nombre,apellido,linkedin_url)
  VALUES(v_nombre,v_apellido,v_url) RETURNING id INTO v_persona_id;
 END IF;
 SELECT id INTO v_vinculo_id FROM public.lr_pros_vinculos
 WHERE empresa_id=v_empresa_id AND persona_id=v_persona_id;
 IF v_vinculo_id IS NULL THEN
  INSERT INTO public.lr_pros_vinculos(empresa_id,persona_id,cargo,fuente)
  VALUES(v_empresa_id,v_persona_id,v_cargo,v_url) RETURNING id INTO v_vinculo_id;
 END IF;
 INSERT INTO public.lr_pros_lotes(clave,procedencia,firma,estado)
 VALUES('linkedin-pe-'||gen_random_uuid()::text,'linkedin-peru-chrome',md5(p_registro::text),'terminado')
 RETURNING id INTO v_lote_id;
 INSERT INTO public.lr_pros_candidatos(lote_id,id_externo,empresa_id,persona_id,vinculo_id,
   estado,afinidad,desglose,verificacion)
 VALUES(v_lote_id,'linkedin-'||md5(v_url),v_empresa_id,v_persona_id,v_vinculo_id,
   'pendiente',0,'{}'::jsonb,'parcial')
 RETURNING id INTO v_candidato_id;
 INSERT INTO public.lr_pros_evidencias(candidato_id,referencia,sujeto,dimension,campo,url,consultado_en,hecho)
 VALUES
 (v_candidato_id,'linkedin_empresa','empresa','afinidad','empresa_declarada',v_url,current_date,
  left('El perfil profesional revisado muestra como empresa: '||v_empresa_nombre||'. Asociación pendiente de verificación humana.',600)),
 (v_candidato_id,'linkedin_cargo','vinculo','responsable','cargo_declarado',v_url,current_date,
  left('Perfil LinkedIn: '||v_nombre||' '||v_apellido||'. Cargo visible: '||v_cargo||'. Ubicación visible: '||v_ubicacion||'. Vigencia pendiente de confirmar.',600));
 v_result:=jsonb_build_array(jsonb_build_object('status','created','candidate_id',v_candidato_id,'external_id','linkedin-'||md5(v_url)));
 UPDATE public.lr_pros_lotes SET resultados=v_result,terminado_en=now() WHERE id=v_lote_id;
 INSERT INTO public.lr_pros_eventos(lote_id,candidato_id,tipo,detalle)
 VALUES(v_lote_id,v_candidato_id,'linkedin_peru_registrado',
   jsonb_build_object('linkedin_url',v_url,'ubicacion_visible',v_ubicacion,'registrado_por',auth.uid(),'verificacion','parcial'));
 RETURN jsonb_build_object('status','created','candidate_id',v_candidato_id,
   'linkedin_url',v_url,'verification','parcial');
END
$fn$;
REVOKE ALL ON FUNCTION public.lr_pros_registrar_linkedin_peru(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_registrar_linkedin_peru(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';