-- Lo que le faltaba a lr_acrm_cotizaciones para que el módulo pueda dejar de usar el bloque JSON.
--
-- Al migrar las 22 me quedé corto en tres campos que el módulo sí edita y guarda. Sin ellos, pasar
-- la pantalla a la tabla perdería datos:
--   · servicio_estandar: el servicio del catálogo que se elige en el desplegable, distinto del
--     texto libre que vino de la hoja.
--   · contactos: el registro de cada toque con su tipo, fecha, orden y nota. contactos_hechos solo
--     cuenta; esto es el historial.
--   · cantidad_contactos: el conteo que el módulo guardaba aparte y que puede venir del XLS.
--
-- Y una operación más: guardar varias cotizaciones de una vez, que es como escribe el módulo.
BEGIN;

ALTER TABLE public.lr_acrm_cotizaciones
 ADD COLUMN servicio_estandar text NOT NULL DEFAULT '' CHECK(length(servicio_estandar)<=300),
 ADD COLUMN contactos jsonb NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN cantidad_contactos integer NOT NULL DEFAULT 0 CHECK(cantidad_contactos BETWEEN 0 AND 1000);

-- Se rellenan desde el bloque JSON, que sigue siendo la copia buena hasta que la pantalla cambie.
UPDATE public.lr_acrm_cotizaciones c SET
 servicio_estandar=left(coalesce(q->>'servicioEstandar',''),300),
 contactos=CASE WHEN jsonb_typeof(q->'contactos')='array' THEN q->'contactos' ELSE '[]'::jsonb END,
 cantidad_contactos=least(1000,greatest(0,coalesce((q->>'cantidadContactos')::int,0)))
FROM public.lr_suite_private_data d, jsonb_array_elements(d.payload) q
WHERE d.key='quotes' AND q->>'id'=c.id;

-- ── Guardar varias de una vez ──────────────────────────────────────────────
-- El módulo mantiene la lista entera en memoria y la guarda de golpe. Una sola llamada por
-- guardado, y todas dentro de la misma transacción: o entran todas o no entra ninguna.
CREATE OR REPLACE FUNCTION private.lr_acrm_cotizaciones_guardar(p_items jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_uid uuid:=auth.uid(); q jsonb; v_clave text; n integer:=0;
BEGIN
 IF v_uid IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_items)<>'array' THEN RAISE EXCEPTION 'Se esperaba una lista de cotizaciones'; END IF;
 FOR q IN SELECT jsonb_array_elements(p_items) LOOP
  IF coalesce(q->>'id','')='' THEN CONTINUE; END IF;
  v_clave:=nullif(q->>'captura','');
  IF v_clave IS NULL THEN
   v_clave:='co:'||(q->>'id');
   INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en)
   VALUES(v_clave,'directo',left(coalesce(nullif(q->>'cliente',''),'Cliente sin nombre'),300),
    coalesce((q->>'enviada')::timestamptz,now()))
   ON CONFLICT(clave) DO NOTHING;
  END IF;
  INSERT INTO public.lr_acrm_cotizaciones(id,captura,cliente,contacto,telefono,email,servicio,
   servicio_estandar,origen,monto,facturado,gastos,estado,enviada,contactos_hechos,
   cantidad_contactos,contactos,archivo_url,archivo_tipo,desglose,actualizado_por)
  VALUES(q->>'id',v_clave,
   left(coalesce(q->>'cliente',''),300),left(coalesce(q->>'contacto',''),300),
   left(coalesce(q->>'telefono',''),60),left(coalesce(q->>'email',''),200),
   left(coalesce(q->>'servicio',''),300),left(coalesce(q->>'servicio_estandar',''),300),
   left(coalesce(q->>'origen',''),60),
   coalesce((q->>'monto')::numeric,0),coalesce((q->>'facturado')::numeric,0),
   coalesce((q->>'gastos')::numeric,0),coalesce(nullif(q->>'estado',''),'enviada'),
   nullif(q->>'enviada','')::date,
   least(8,greatest(0,coalesce((q->>'contactos_hechos')::int,0))),
   least(1000,greatest(0,coalesce((q->>'cantidad_contactos')::int,0))),
   CASE WHEN jsonb_typeof(q->'contactos')='array' THEN q->'contactos' ELSE '[]'::jsonb END,
   nullif(q->>'archivo_url',''),nullif(q->>'archivo_tipo',''),
   CASE WHEN jsonb_typeof(q->'desglose')='array' THEN q->'desglose' ELSE '[]'::jsonb END,
   v_uid)
  ON CONFLICT(id) DO UPDATE SET
   cliente=EXCLUDED.cliente,contacto=EXCLUDED.contacto,telefono=EXCLUDED.telefono,email=EXCLUDED.email,
   servicio=EXCLUDED.servicio,servicio_estandar=EXCLUDED.servicio_estandar,origen=EXCLUDED.origen,
   monto=EXCLUDED.monto,facturado=EXCLUDED.facturado,gastos=EXCLUDED.gastos,estado=EXCLUDED.estado,
   enviada=EXCLUDED.enviada,contactos_hechos=EXCLUDED.contactos_hechos,
   cantidad_contactos=EXCLUDED.cantidad_contactos,contactos=EXCLUDED.contactos,
   archivo_url=EXCLUDED.archivo_url,archivo_tipo=EXCLUDED.archivo_tipo,desglose=EXCLUDED.desglose,
   version=lr_acrm_cotizaciones.version+1,actualizado_en=now(),actualizado_por=v_uid;
  -- El embudo sigue a la cotización, igual que en la rama de una sola.
  INSERT INTO public.lr_acrm_embudo(captura,etapa,cotizado_en,cotizacion,monto,actualizado_por)
  SELECT c.captura,
   CASE WHEN c.estado='aprobada' THEN 'ganado' WHEN c.estado='perdida' THEN 'perdido' ELSE 'cotizado' END,
   coalesce(c.enviada::timestamptz,now()),c.id,c.monto,v_uid
  FROM public.lr_acrm_cotizaciones c WHERE c.id=q->>'id'
  ON CONFLICT(captura) DO UPDATE SET
   etapa=CASE WHEN EXCLUDED.etapa IN ('ganado','perdido') THEN EXCLUDED.etapa
              WHEN private.lr_acrm_etapa_orden(lr_acrm_embudo.etapa)<3 THEN 'cotizado'
              ELSE lr_acrm_embudo.etapa END,
   cotizado_en=coalesce(lr_acrm_embudo.cotizado_en,EXCLUDED.cotizado_en),
   cerrado_en=CASE WHEN EXCLUDED.etapa IN ('ganado','perdido') THEN coalesce(lr_acrm_embudo.cerrado_en,now()) ELSE NULL END,
   cotizacion=EXCLUDED.cotizacion,monto=EXCLUDED.monto,
   version=lr_acrm_embudo.version+1,actualizado_en=now(),actualizado_por=v_uid;
  n:=n+1;
 END LOOP;
 PERFORM private.lr_acrm_cotizaciones_al_dia();
 RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_cotizaciones_guardar(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_cotizaciones_guardar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.lr_acrm_cotizaciones_guardar(p_items jsonb) RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.lr_acrm_cotizaciones_guardar(p_items);
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_cotizaciones_guardar(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_cotizaciones_guardar(jsonb) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
