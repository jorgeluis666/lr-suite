-- LR Suite · Mi base de contactos LinkedIn por usuario
-- Diseño aditivo: no modifica ni elimina datos del CRM ni Investigación existentes.
CREATE TABLE IF NOT EXISTS public.lr_pros_contactos_propios (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 clave text NOT NULL CHECK (length(clave) BETWEEN 5 AND 500),
 linkedin_url text,
 nombre text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 120),
 apellido text NOT NULL CHECK (length(apellido) BETWEEN 1 AND 150),
 empresa text,
 cargo text,
 ubicacion text,
 peru_verificado boolean NOT NULL DEFAULT false,
 fecha_conexion text,
 origen text NOT NULL DEFAULT 'connections_csv' CHECK (origen IN ('connections_csv','manual')),
 apariciones integer NOT NULL DEFAULT 1 CHECK (apariciones >= 1),
 primera_carga_en timestamptz NOT NULL DEFAULT now(),
 ultima_carga_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 UNIQUE (usuario_id,clave),
 CONSTRAINT lr_contactos_propio_ubicacion_check CHECK (NOT peru_verificado OR ubicacion IS NOT NULL),
 CONSTRAINT lr_contactos_propio_empresa_check CHECK (empresa IS NULL OR length(empresa)<=200),
 CONSTRAINT lr_contactos_propio_cargo_check CHECK (cargo IS NULL OR length(cargo)<=200),
 CONSTRAINT lr_contactos_propio_region_check CHECK (ubicacion IS NULL OR length(ubicacion)<=160),
 CONSTRAINT lr_contactos_propio_fecha_check CHECK (fecha_conexion IS NULL OR length(fecha_conexion)<=100),
 CONSTRAINT lr_contactos_propio_url_check CHECK (linkedin_url IS NULL OR linkedin_url ~ '^https://www[.]linkedin[.]com/in/[a-z0-9][a-z0-9_.%-]{1,180}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS lr_pros_contactos_propios_por_url
 ON public.lr_pros_contactos_propios(usuario_id,linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS lr_pros_contactos_propios_recientes
 ON public.lr_pros_contactos_propios(usuario_id,actualizado_en DESC);
ALTER TABLE public.lr_pros_contactos_propios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lr_pros_contactos_propios FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lr_pros_contactos_propios TO authenticated;
DROP POLICY IF EXISTS lr_pros_contactos_propios_solo_dueno ON public.lr_pros_contactos_propios;
CREATE POLICY lr_pros_contactos_propios_solo_dueno ON public.lr_pros_contactos_propios FOR SELECT TO authenticated
 USING (usuario_id=(SELECT auth.uid()) AND (SELECT public.is_lr_suite_pending_user()));

CREATE TABLE IF NOT EXISTS public.lr_pros_cargas_propias (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 lote_id uuid NOT NULL,
 parte integer NOT NULL CHECK (parte BETWEEN 0 AND 100000),
 archivo text NOT NULL CHECK(length(archivo) BETWEEN 1 AND 180),
 huella text NOT NULL,
 procesados integer NOT NULL DEFAULT 0,
 nuevos integer NOT NULL DEFAULT 0,
 actualizados integer NOT NULL DEFAULT 0,
 sin_cambios integer NOT NULL DEFAULT 0,
 rechazados integer NOT NULL DEFAULT 0,
 detalles jsonb NOT NULL DEFAULT '[]'::jsonb,
 creado_en timestamptz NOT NULL DEFAULT now(),
 UNIQUE (usuario_id,lote_id,parte)
);
CREATE INDEX IF NOT EXISTS lr_pros_cargas_propias_recientes ON public.lr_pros_cargas_propias(usuario_id,creado_en DESC);
ALTER TABLE public.lr_pros_cargas_propias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lr_pros_cargas_propias FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lr_pros_cargas_propias TO authenticated;
DROP POLICY IF EXISTS lr_pros_cargas_propias_solo_dueno ON public.lr_pros_cargas_propias;
CREATE POLICY lr_pros_cargas_propias_solo_dueno ON public.lr_pros_cargas_propias FOR SELECT TO authenticated
 USING(usuario_id=(SELECT auth.uid()) AND (SELECT public.is_lr_suite_pending_user()));

CREATE OR REPLACE FUNCTION public.lr_pros_importar_mis_contactos(p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth','pg_temp'
AS $fn$
DECLARE
 v_uid uuid:=auth.uid();
 v_lote uuid;
 v_parte integer;
 v_origen text;
 v_archivo text;
 v_rows jsonb;
 v_huella text;
 v_previa public.lr_pros_cargas_propias%rowtype;
 v_existente public.lr_pros_contactos_propios%rowtype;
 v_match_count integer;v_match_id uuid;
 v_item jsonb;
 v_nombre text;v_apellido text;v_empresa text;v_cargo text;v_url text;
 v_ubicacion text;v_fecha text;v_clave text;v_alterna text;v_verificado boolean;
 v_new_nombre text;v_new_apellido text;v_new_empresa text;v_new_cargo text;
 v_new_url text;v_new_ubicacion text;v_new_fecha text;v_new_verificado boolean;
 v_nuevos integer:=0;v_actualizados integer:=0;v_iguales integer:=0;v_rechazados integer:=0;
 v_error jsonb:='[]'::jsonb;v_index integer:=0;v_change boolean;
BEGIN
 IF v_uid IS NULL OR NOT public.is_lr_suite_pending_user() THEN
   RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_datos)<>'object' OR jsonb_typeof(p_datos->'contactos')<>'array' THEN
  RAISE EXCEPTION 'Solicitud inválida; contactos debe ser un arreglo';
 END IF;
 v_rows:=p_datos->'contactos';
 IF jsonb_array_length(v_rows)<1 OR jsonb_array_length(v_rows)>100 THEN
  RAISE EXCEPTION 'Cada lote debe contener entre 1 y 100 contactos';
 END IF;
 v_lote:=(p_datos->>'lote_id')::uuid;
 v_parte:=(p_datos->>'parte')::integer;
 v_origen:=p_datos->>'origen';
 v_archivo:=nullif(btrim(p_datos->>'archivo'),'');
 IF v_lote IS NULL OR v_parte NOT BETWEEN 0 AND 100000
  OR v_origen NOT IN ('connections_csv','manual')
  OR v_archivo IS NULL OR length(v_archivo)>180 THEN
  RAISE EXCEPTION 'Parámetros de carga inválidos';
 END IF;
 v_huella:=md5(v_rows::text);
 PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text||'|'||v_lote::text||'|'||v_parte,0));
 SELECT * INTO v_previa FROM public.lr_pros_cargas_propias
  WHERE usuario_id=v_uid AND lote_id=v_lote AND parte=v_parte FOR UPDATE;
 IF FOUND THEN
  IF v_previa.huella<>v_huella THEN RAISE EXCEPTION 'El mismo lote y parte contienen datos diferentes'; END IF;
  RETURN jsonb_build_object('reimportado',true,'procesados',v_previa.procesados,'nuevos',v_previa.nuevos,
   'actualizados',v_previa.actualizados,'sin_cambios',v_previa.sin_cambios,'rechazados',v_previa.rechazados,
   'errores',v_previa.detalles);
 END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
  v_index:=v_index+1;
  BEGIN
   IF jsonb_typeof(v_item)<>'object' THEN RAISE EXCEPTION 'Contacto inválido'; END IF;
   v_nombre:=nullif(btrim(v_item->>'nombre'),'');
   v_apellido:=nullif(btrim(v_item->>'apellido'),'');
   v_empresa:=nullif(btrim(v_item->>'empresa'),'');
   v_cargo:=nullif(btrim(v_item->>'cargo'),'');
   v_ubicacion:=nullif(btrim(v_item->>'ubicacion'),'');
   v_fecha:=nullif(btrim(v_item->>'fecha_conexion'),'');
   v_url:=public.lr_pros_linkedin_normalizada(v_item->>'linkedin_url','in');
   v_verificado:=coalesce((v_item->>'peru_verificado')::boolean,false);
   IF v_nombre IS NULL OR v_apellido IS NULL OR length(v_nombre)>120 OR length(v_apellido)>150 THEN
    RAISE EXCEPTION 'Nombre y apellido obligatorios (máximo 120/150 caracteres)';
   END IF;
   IF v_url IS NULL AND v_empresa IS NULL THEN
    RAISE EXCEPTION 'Sin URL de perfil ni empresa no podemos distinguir homónimos';
   END IF;
   IF length(coalesce(v_empresa,''))>200 OR length(coalesce(v_cargo,''))>200
     OR length(coalesce(v_ubicacion,''))>160 OR length(coalesce(v_fecha,''))>100 THEN
    RAISE EXCEPTION 'Algún campo excede la longitud permitida';
   END IF;
   IF v_verificado AND (v_ubicacion IS NULL OR lower(v_ubicacion) !~ '(^|[^[:alpha:]])per[uú]([^[:alpha:]]|$)') THEN
     RAISE EXCEPTION 'La ubicación Perú requiere evidencia visible y confirmación';
   END IF;
   v_alterna:='n:'||md5(lower(v_nombre)||'|'||lower(v_apellido)||'|'||lower(coalesce(v_empresa,'')));
   v_clave:=CASE WHEN v_url IS NOT NULL THEN 'li:'||v_url ELSE v_alterna END;
   PERFORM pg_advisory_xact_lock(hashtextextended('own-contact:'||v_uid::text||':'||v_clave,0));
   SELECT * INTO v_existente FROM public.lr_pros_contactos_propios
    WHERE usuario_id=v_uid AND (clave=v_clave OR (v_url IS NOT NULL AND linkedin_url=v_url))
    ORDER BY primera_carga_en NULLS LAST LIMIT 1 FOR UPDATE;
   -- Un perfil con URL puede enriquecer una antigua fila del CSV sin URL.
   IF NOT FOUND AND v_url IS NOT NULL THEN
    SELECT * INTO v_existente FROM public.lr_pros_contactos_propios
     WHERE usuario_id=v_uid AND clave=v_alterna AND linkedin_url IS NULL
     LIMIT 1 FOR UPDATE;
   END IF;
   IF v_existente.id IS NULL AND v_url IS NULL THEN
    -- La reimportación del CSV puede encontrar un perfil previamente enriquecido con URL.
    -- No fusionar homónimos si hay más de una coincidencia.
    SELECT count(*),min(id) INTO v_match_count,v_match_id
     FROM public.lr_pros_contactos_propios
     WHERE usuario_id=v_uid AND lower(nombre)=lower(v_nombre) AND lower(apellido)=lower(v_apellido)
       AND lower(coalesce(empresa,''))=lower(coalesce(v_empresa,''));
    IF v_match_count>1 THEN RAISE EXCEPTION 'Homónimos: requiere revisión manual'; END IF;
    IF v_match_count=1 THEN
     SELECT * INTO v_existente FROM public.lr_pros_contactos_propios
      WHERE id=v_match_id FOR UPDATE;
    END IF;
   END IF;
   IF v_existente.id IS NULL THEN
    INSERT INTO public.lr_pros_contactos_propios(
      usuario_id,clave,linkedin_url,nombre,apellido,empresa,cargo,ubicacion,
      peru_verificado,fecha_conexion,origen
    ) VALUES (v_uid,v_clave,v_url,v_nombre,v_apellido,v_empresa,v_cargo,v_ubicacion,
      v_verificado,v_fecha,v_origen);
    v_nuevos:=v_nuevos+1;
   ELSE
    v_new_nombre:=coalesce(v_nombre,v_existente.nombre);
    v_new_apellido:=coalesce(v_apellido,v_existente.apellido);
    v_new_empresa:=coalesce(v_empresa,v_existente.empresa);
    v_new_cargo:=coalesce(v_cargo,v_existente.cargo);
    v_new_url:=coalesce(v_url,v_existente.linkedin_url);
    v_new_ubicacion:=coalesce(v_ubicacion,v_existente.ubicacion);
    v_new_fecha:=coalesce(v_fecha,v_existente.fecha_conexion);
    v_new_verificado:=CASE WHEN v_ubicacion IS NOT NULL AND NOT v_verificado
      THEN false ELSE v_existente.peru_verificado OR v_verificado END;
    v_change:=((v_url IS NOT NULL AND v_existente.clave IS DISTINCT FROM v_clave)
       OR v_existente.nombre IS DISTINCT FROM v_new_nombre
       OR v_existente.apellido IS DISTINCT FROM v_new_apellido
       OR v_existente.empresa IS DISTINCT FROM v_new_empresa
       OR v_existente.cargo IS DISTINCT FROM v_new_cargo
       OR v_existente.linkedin_url IS DISTINCT FROM v_new_url
       OR v_existente.ubicacion IS DISTINCT FROM v_new_ubicacion
       OR v_existente.fecha_conexion IS DISTINCT FROM v_new_fecha
       OR v_existente.peru_verificado IS DISTINCT FROM v_new_verificado);
    UPDATE public.lr_pros_contactos_propios SET
       clave=CASE WHEN v_url IS NOT NULL THEN v_clave ELSE clave END,
       nombre=v_new_nombre,apellido=v_new_apellido,empresa=v_new_empresa,cargo=v_new_cargo,
       linkedin_url=v_new_url,ubicacion=v_new_ubicacion,peru_verificado=v_new_verificado,
       fecha_conexion=v_new_fecha,apariciones=apariciones+1,ultima_carga_en=now(),
       actualizado_en=CASE WHEN v_change THEN now() ELSE actualizado_en END,
       origen=CASE WHEN v_origen='manual' THEN 'manual' ELSE origen END
    WHERE id=v_existente.id;
    IF v_change THEN v_actualizados:=v_actualizados+1;ELSE v_iguales:=v_iguales+1;END IF;
   END IF;
  EXCEPTION WHEN OTHERS THEN
   v_rechazados:=v_rechazados+1;
   IF jsonb_array_length(v_error)<15 THEN
    v_error:=v_error||jsonb_build_array(jsonb_build_object('fila',v_index,'motivo',left(sqlerrm,180)));
   END IF;
  END;
 END LOOP;
 INSERT INTO public.lr_pros_cargas_propias(
  usuario_id,lote_id,parte,archivo,huella,procesados,nuevos,actualizados,sin_cambios,rechazados,detalles
 ) VALUES (v_uid,v_lote,v_parte,v_archivo,v_huella,jsonb_array_length(v_rows),
   v_nuevos,v_actualizados,v_iguales,v_rechazados,v_error);
 RETURN jsonb_build_object('reimportado',false,'procesados',jsonb_array_length(v_rows),
   'nuevos',v_nuevos,'actualizados',v_actualizados,'sin_cambios',v_iguales,
   'rechazados',v_rechazados,'errores',v_error);
END
$fn$;
REVOKE ALL ON FUNCTION public.lr_pros_importar_mis_contactos(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_importar_mis_contactos(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';