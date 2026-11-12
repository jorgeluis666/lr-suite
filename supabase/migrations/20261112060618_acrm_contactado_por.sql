BEGIN;
ALTER TABLE public.lr_acrm_capturas ADD COLUMN IF NOT EXISTS contactado_por uuid REFERENCES public.lr_pros_colaboradores(usuario_id);

-- Preserve known first contacts; importing a profile does not mean contacting it.
UPDATE public.lr_acrm_capturas c SET contactado_por=r.contactado_por
FROM public.lr_acrm_contactos r
WHERE c.clave='li:'||r.linkedin_url AND c.contactado_por IS NULL
 AND r.contactado_por IS NOT NULL;

-- Writes use the same authorized-team boundary as the other ACRM operations.
CREATE OR REPLACE FUNCTION private.lr_acrm_contactado_por(p_captura text,p_usuario uuid,p_anterior uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.uid() IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN
  RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501';
 END IF;
 IF p_usuario IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id=p_usuario AND activo
 ) THEN RAISE EXCEPTION 'Selecciona un usuario activo del sistema'; END IF;
 UPDATE public.lr_acrm_capturas SET contactado_por=p_usuario
 WHERE clave=p_captura AND contactado_por IS NOT DISTINCT FROM p_anterior;
 IF NOT FOUND THEN RAISE EXCEPTION 'El contacto cambió o ya no existe. Actualiza la tabla.'; END IF;
 RETURN jsonb_build_object('ok',true,'contactado_por',p_usuario);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_contactado_por(text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_contactado_por(text,uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.lr_acrm_contactado_por(p_captura text,p_usuario uuid,p_anterior uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.lr_acrm_contactado_por(p_captura,p_usuario,p_anterior);
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_contactado_por(text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_contactado_por(text,uuid,uuid) TO authenticated;
COMMIT;
