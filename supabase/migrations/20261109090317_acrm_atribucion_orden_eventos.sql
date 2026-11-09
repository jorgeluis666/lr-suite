BEGIN;
CREATE OR REPLACE FUNCTION public.lr_acrm_recibir_meta(p_evento jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE k text; v_owner uuid; v_time timestamptz;
BEGIN
 IF coalesce(p_evento->>'telefono','')!~'^[0-9]{7,20}$' OR coalesce(p_evento->>'phone_id','')!~'^[0-9]{3,30}$' OR length(coalesce(p_evento->>'id','')) NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'Evento inválido'; END IF;
 v_time:=(p_evento->>'fecha')::timestamptz;
 IF v_time IS NULL OR v_time>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Fecha inválida'; END IF;
 INSERT INTO public.lr_acrm_meta_recibidos(id) VALUES(p_evento->>'id') ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 k:='wa:'||(p_evento->>'phone_id')||':'||(p_evento->>'telefono');
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(k,1));
 INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en,consulta,ultimo_mensaje_en,anuncio_id)
 VALUES(k,'meta_whatsapp',left(coalesce(p_evento->>'nombre','Lead WhatsApp'),300),v_time,left(coalesce(p_evento->>'consulta','Mensaje adjunto'),2000),v_time,nullif(p_evento->>'anuncio_id',''))
 ON CONFLICT(clave) DO UPDATE SET capturado_en=least(lr_acrm_capturas.capturado_en,EXCLUDED.capturado_en),
  anuncio_id=CASE WHEN EXCLUDED.capturado_en<lr_acrm_capturas.capturado_en THEN EXCLUDED.anuncio_id WHEN EXCLUDED.capturado_en=lr_acrm_capturas.capturado_en THEN coalesce(lr_acrm_capturas.anuncio_id,EXCLUDED.anuncio_id) ELSE lr_acrm_capturas.anuncio_id END,
  consulta=CASE WHEN EXCLUDED.ultimo_mensaje_en>=lr_acrm_capturas.ultimo_mensaje_en THEN EXCLUDED.consulta ELSE lr_acrm_capturas.consulta END,
  ultimo_mensaje_en=greatest(lr_acrm_capturas.ultimo_mensaje_en,EXCLUDED.ultimo_mensaje_en);
 SELECT responsable INTO v_owner FROM public.lr_acrm_acciones WHERE captura=k ORDER BY creado_en DESC LIMIT 1;
 IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id=v_owner AND activo) THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(982432);
  SELECT m.usuario_id INTO v_owner FROM public.lr_pros_colaboradores m LEFT JOIN public.lr_acrm_acciones a ON a.responsable=m.usuario_id AND a.estado='pendiente'
  WHERE m.activo GROUP BY m.usuario_id,m.nombre ORDER BY count(a.id),m.nombre LIMIT 1;
 END IF;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Sin responsable habilitado'; END IF;
 INSERT INTO public.lr_acrm_acciones(captura,responsable,accion,vence_en,tipo)
 VALUES(k,v_owner,'Responder consulta de WhatsApp',now(),'respuesta')
 ON CONFLICT(captura) WHERE tipo='respuesta' AND estado='pendiente'
 DO UPDATE SET version=lr_acrm_acciones.version+1,prioridad_ia=NULL,motivo_ia=NULL,ia_en=NULL,vence_en=least(lr_acrm_acciones.vence_en,now());
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_recibir_meta(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lr_acrm_recibir_meta(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
