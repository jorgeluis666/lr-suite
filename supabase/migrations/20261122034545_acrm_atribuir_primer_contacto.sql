-- El autor se toma de la acción que acredita el contacto. Una confirmación y
-- un envío posterior pueden llegar por caminos distintos para el mismo lead.
CREATE FUNCTION private.lr_acrm_atribuir_primer_contacto() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  clave_lead text;
  persona uuid;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'lr_acrm_contacto_eventos' THEN
      clave_lead := 'li:' || NEW.linkedin_url;
      persona := NEW.actor;
    WHEN 'lr_acrm_mensajes' THEN
      clave_lead := NEW.captura;
      persona := NEW.autor;
    WHEN 'lr_acrm_embudo' THEN
      clave_lead := NEW.captura;
      persona := NEW.actualizado_por;
  END CASE;

  UPDATE public.lr_acrm_capturas
  SET contactado_por = persona
  WHERE clave = clave_lead AND contactado_por IS NULL;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.lr_acrm_atribuir_primer_contacto()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER lr_acrm_confirmacion_registra_autor
AFTER INSERT ON public.lr_acrm_contacto_eventos
FOR EACH ROW WHEN (NEW.accion = 'confirmar')
EXECUTE FUNCTION private.lr_acrm_atribuir_primer_contacto();

CREATE TRIGGER lr_acrm_mensaje_registra_autor
AFTER INSERT ON public.lr_acrm_mensajes
FOR EACH ROW WHEN (NEW.direccion = 'enviado' AND NEW.autor IS NOT NULL)
EXECUTE FUNCTION private.lr_acrm_atribuir_primer_contacto();

-- Solo el cambio explícito de etapa de la sesión. Los cambios que hagan
-- otros triggers (por ejemplo, una respuesta del bot) tienen su propia fuente.
CREATE TRIGGER lr_acrm_etapa_manual_registra_autor
AFTER UPDATE OF etapa ON public.lr_acrm_embudo
FOR EACH ROW WHEN (
  OLD.etapa IS DISTINCT FROM NEW.etapa AND NEW.etapa = 'contactado'
  AND NEW.actualizado_por = auth.uid() AND pg_trigger_depth() = 0
)
EXECUTE FUNCTION private.lr_acrm_atribuir_primer_contacto();

-- Reparar únicamente capturas de LinkedIn con reserva cerrada y confirmación
-- del mismo autor. La importación y la última edición no acreditan un envío.
UPDATE public.lr_acrm_capturas c
SET contactado_por = r.contactado_por
FROM public.lr_acrm_contactos r, public.lr_acrm_embudo e
WHERE c.clave = 'li:' || r.linkedin_url AND c.canal = 'linkedin'
  AND e.captura = c.clave AND e.etapa = 'contactado'
  AND c.contactado_por IS NULL AND r.estado = 'contactado'
  AND EXISTS (
    SELECT 1 FROM public.lr_acrm_contacto_eventos ev
    WHERE ev.linkedin_url = r.linkedin_url AND ev.accion = 'confirmar'
      AND ev.actor = r.contactado_por
  );
