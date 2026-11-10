-- La fecha en que un lead cuenta como «cotizado» sigue a la fecha de envío de su cotización.
--
-- El marcador cuenta los cotizados del mes por lr_acrm_embudo.cotizado_en. Hasta ahora ese dato
-- se fijaba una vez y no se movía: lr_acrm_cotizaciones_guardar() hace coalesce con el valor que ya
-- tenía. Así, una cotización migrada sin fecha (que recibió now()) seguía contando en noviembre
-- aunque luego se le pusiera su fecha de verdad en la pantalla. Y las que sí tenían fecha quedaron a
-- medianoche UTC, que en Lima es las 7 p. m. del día anterior: una enviada el día 1 contaba en el
-- mes anterior.
--
-- Un trigger en la cotización mueve cotizado_en cada vez que cambia su fecha, al mediodía de Lima
-- de ese día, y una corrección única alinea las que ya están desfasadas.
BEGIN;

CREATE FUNCTION private.lr_acrm_cotizado_sigue_a_enviada() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.enviada IS NOT NULL AND (TG_OP='INSERT' OR NEW.enviada IS DISTINCT FROM OLD.enviada) THEN
  UPDATE public.lr_acrm_embudo
  SET cotizado_en=(NEW.enviada+time '12:00') AT TIME ZONE 'America/Lima',version=version+1
  WHERE captura=NEW.captura AND (cotizacion IS NULL OR cotizacion=NEW.id)
    AND cotizado_en IS DISTINCT FROM (NEW.enviada+time '12:00') AT TIME ZONE 'America/Lima';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_cotizado_sigue_a_enviada() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER lr_acrm_cotizado_sigue_a_enviada
 AFTER INSERT OR UPDATE OF enviada ON public.lr_acrm_cotizaciones
 FOR EACH ROW EXECUTE FUNCTION private.lr_acrm_cotizado_sigue_a_enviada();

-- Las que ya existen: solo las que tienen fecha y cuyo día en Lima no coincide.
UPDATE public.lr_acrm_embudo e
SET cotizado_en=(q.enviada+time '12:00') AT TIME ZONE 'America/Lima',version=e.version+1
FROM public.lr_acrm_cotizaciones q
WHERE e.captura=q.captura AND e.cotizacion=q.id AND q.enviada IS NOT NULL
  AND (e.cotizado_en IS NULL OR (e.cotizado_en AT TIME ZONE 'America/Lima')::date<>q.enviada);

COMMIT;
