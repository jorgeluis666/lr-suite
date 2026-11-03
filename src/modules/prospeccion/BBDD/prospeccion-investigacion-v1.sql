-- LR Suite Prospección - Migración revisable
-- Reconstruida de la estructura verificada en Supabase STAGING el 2026-11-03
-- SOLO PREPARADA. REQUIERE RESPALDO ANTES DE EJECUTAR EN PRODUCCIÓN.
BEGIN;
DO $pre$ BEGIN IF to_regclass('public.lr_suite_prospectos') IS NULL OR to_regprocedure('public.is_lr_suite_pending_user()') IS NULL THEN RAISE EXCEPTION 'No existe base de Prospección o autorización'; END IF; END $pre$;
CREATE OR REPLACE FUNCTION public.lr_pros_dominio(p_url text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v text;
begin
 if nullif(btrim(p_url),'') is null then return null; end if;
 v:=lower(btrim(p_url));
 if v ~ '^(javascript|data|file):' then raise exception 'Esquema de URL no permitido'; end if;
 v:=regexp_replace(v,'^https?://','');
 v:=split_part(split_part(split_part(v,'/',1),'?',1),'#',1);
 v:=regexp_replace(v,'^www\.','');
 if length(v)>253 or v !~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$' or v ~ '\.\.' then
   raise exception 'Dominio corporativo inválido';
 end if;
 return v;
end $function$

CREATE OR REPLACE FUNCTION public.lr_pros_linkedin_normalizada(p_url text, p_tipo text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v text; v_ruta text; v_segmento text;
begin
  if nullif(btrim(p_url),'') is null then return null; end if;
  v:=lower(btrim(p_url));
  if v !~ '^https?://(www\.)?linkedin\.com/' then raise exception 'URL de LinkedIn inválida'; end if;
  v:=split_part(split_part(v,'?',1),'#',1);
  v_ruta:=regexp_replace(v,'^https?://(www\.)?linkedin\.com/','');
  v_ruta:=trim(both '/' from v_ruta);
  if p_tipo not in ('in','company') or v_ruta !~ ('^'||p_tipo||'/[a-z0-9][a-z0-9_.%-]{1,180}$') then
    raise exception 'La URL debe identificar un perfil /in/ o una empresa /company/';
  end if;
  v_segmento:=split_part(v_ruta,'/',2);
  return 'https://www.linkedin.com/'||p_tipo||'/'||v_segmento;
end $function$

CREATE TABLE IF NOT EXISTS public."lr_pros_lotes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "clave" text NOT NULL,
  "procedencia" text NOT NULL,
  "firma" text NOT NULL,
  "resultados" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "estado" text DEFAULT 'procesando'::text NOT NULL,
  "creado_por" uuid DEFAULT auth.uid() NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  "terminado_en" timestamp with time zone,
  CONSTRAINT "lr_pros_lotes_clave_check" CHECK (length(clave) >= 1 AND length(clave) <= 120),
  CONSTRAINT "lr_pros_lotes_estado_check" CHECK (estado = ANY (ARRAY['procesando'::text, 'terminado'::text])),
  CONSTRAINT "lr_pros_lotes_procedencia_check" CHECK (length(procedencia) >= 1 AND length(procedencia) <= 120),
  CONSTRAINT "lr_pros_lotes_pkey" PRIMARY KEY (id),
  CONSTRAINT "lr_pros_lotes_clave_procedencia_key" UNIQUE (clave, procedencia)
);
CREATE TABLE IF NOT EXISTS public."lr_pros_empresas" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "nombre" text NOT NULL,
  "nombre_normalizado" text NOT NULL,
  "segmento" text NOT NULL,
  "web" text,
  "dominio_normalizado" text,
  "linkedin_url" text,
  "posible_duplicado_de" uuid,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lr_pros_empresas_nombre_check" CHECK (length(nombre) >= 2 AND length(nombre) <= 200),
  CONSTRAINT "lr_pros_empresas_segmento_check" CHECK (segmento = ANY (ARRAY['retail_ecommerce'::text, 'servicios_leads'::text])),
  CONSTRAINT "lr_pros_empresas_posible_duplicado_de_fkey" FOREIGN KEY (posible_duplicado_de) REFERENCES lr_pros_empresas(id) ON DELETE RESTRICT,
  CONSTRAINT "lr_pros_empresas_pkey" PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public."lr_pros_personas" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "nombre" text,
  "apellido" text,
  "linkedin_url" text,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lr_pros_personas_apellido_check" CHECK (apellido IS NULL OR length(apellido) <= 150),
  CONSTRAINT "lr_pros_personas_nombre_check" CHECK (nombre IS NULL OR length(nombre) <= 120),
  CONSTRAINT "lr_pros_personas_pkey" PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public."lr_pros_vinculos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "empresa_id" uuid NOT NULL,
  "persona_id" uuid NOT NULL,
  "cargo" text,
  "fuente" text,
  "verificado_en" date,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lr_pros_vinculos_cargo_check" CHECK (cargo IS NULL OR length(cargo) <= 180),
  CONSTRAINT "lr_pros_vinculos_fuente_check" CHECK (fuente IS NULL OR length(fuente) <= 700),
  CONSTRAINT "lr_pros_vinculos_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES lr_pros_empresas(id) ON DELETE RESTRICT,
  CONSTRAINT "lr_pros_vinculos_persona_id_fkey" FOREIGN KEY (persona_id) REFERENCES lr_pros_personas(id) ON DELETE RESTRICT,
  CONSTRAINT "lr_pros_vinculos_pkey" PRIMARY KEY (id),
  CONSTRAINT "lr_pros_vinculos_empresa_id_persona_id_key" UNIQUE (empresa_id, persona_id)
);
CREATE TABLE IF NOT EXISTS public."lr_pros_candidatos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "lote_id" uuid NOT NULL,
  "id_externo" text NOT NULL,
  "empresa_id" uuid NOT NULL,
  "persona_id" uuid,
  "vinculo_id" uuid,
  "estado" text DEFAULT 'pendiente'::text NOT NULL,
  "afinidad" integer DEFAULT 0 NOT NULL,
  "version_rubrica" text DEFAULT 'lr-v1.0'::text NOT NULL,
  "desglose" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "verificacion" text DEFAULT 'sin_evidencia'::text NOT NULL,
  "notas_revision" text DEFAULT ''::text NOT NULL,
  "revisado_por" uuid,
  "revisado_en" timestamp with time zone,
  "prospecto_id" uuid,
  "promovido_en" timestamp with time zone,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lr_pros_candidatos_afinidad_check" CHECK (afinidad >= 0 AND afinidad <= 100),
  CONSTRAINT "lr_pros_candidatos_estado_check" CHECK (estado = ANY (ARRAY['pendiente'::text, 'requiere_revision'::text, 'validado'::text, 'rechazado'::text])),
  CONSTRAINT "lr_pros_candidatos_id_externo_check" CHECK (length(id_externo) >= 1 AND length(id_externo) <= 120),
  CONSTRAINT "lr_pros_candidatos_verificacion_check" CHECK (verificacion = ANY (ARRAY['sin_evidencia'::text, 'parcial'::text, 'documentada'::text])),
  CONSTRAINT "lr_pros_candidatos_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES lr_pros_empresas(id) ON DELETE RESTRICT,
  CONSTRAINT "lr_pros_candidatos_lote_id_fkey" FOREIGN KEY (lote_id) REFERENCES lr_pros_lotes(id) ON DELETE RESTRICT,
  CONSTRAINT "lr_pros_candidatos_persona_id_fkey" FOREIGN KEY (persona_id) REFERENCES lr_pros_personas(id) ON DELETE RESTRICT,
  CONSTRAINT "lr_pros_candidatos_prospecto_id_fkey" FOREIGN KEY (prospecto_id) REFERENCES lr_suite_prospectos(id) ON DELETE RESTRICT,
  CONSTRAINT "lr_pros_candidatos_vinculo_id_fkey" FOREIGN KEY (vinculo_id) REFERENCES lr_pros_vinculos(id) ON DELETE RESTRICT,
  CONSTRAINT "lr_pros_candidatos_pkey" PRIMARY KEY (id),
  CONSTRAINT "lr_pros_candidatos_lote_id_id_externo_key" UNIQUE (lote_id, id_externo)
);
CREATE TABLE IF NOT EXISTS public."lr_pros_evidencias" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "candidato_id" uuid NOT NULL,
  "referencia" text NOT NULL,
  "sujeto" text NOT NULL,
  "dimension" text NOT NULL,
  "campo" text NOT NULL,
  "url" text NOT NULL,
  "consultado_en" date NOT NULL,
  "observado_en" date,
  "hecho" text NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lr_pros_evidencias_campo_check" CHECK (length(campo) >= 1 AND length(campo) <= 100),
  CONSTRAINT "lr_pros_evidencias_dimension_check" CHECK (dimension = ANY (ARRAY['afinidad'::text, 'operacion'::text, 'canal'::text, 'publicidad'::text, 'oportunidad'::text, 'responsable'::text])),
  CONSTRAINT "lr_pros_evidencias_hecho_check" CHECK (length(hecho) >= 5 AND length(hecho) <= 600),
  CONSTRAINT "lr_pros_evidencias_referencia_check" CHECK (length(referencia) >= 1 AND length(referencia) <= 100),
  CONSTRAINT "lr_pros_evidencias_sujeto_check" CHECK (sujeto = ANY (ARRAY['empresa'::text, 'persona'::text, 'vinculo'::text])),
  CONSTRAINT "lr_pros_evidencias_url_check" CHECK (length(url) >= 12 AND length(url) <= 1200 AND url ~* '^https://'::text AND url !~* '^https://[^/]*@'::text),
  CONSTRAINT "lr_pros_evidencias_candidato_id_fkey" FOREIGN KEY (candidato_id) REFERENCES lr_pros_candidatos(id) ON DELETE RESTRICT,
  CONSTRAINT "lr_pros_evidencias_pkey" PRIMARY KEY (id),
  CONSTRAINT "lr_pros_evidencias_candidato_id_referencia_key" UNIQUE (candidato_id, referencia)
);
CREATE TABLE IF NOT EXISTS public."lr_pros_eventos" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "candidato_id" uuid,
  "lote_id" uuid,
  "tipo" text NOT NULL,
  "detalle" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actor" uuid DEFAULT auth.uid(),
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lr_pros_eventos_candidato_id_fkey" FOREIGN KEY (candidato_id) REFERENCES lr_pros_candidatos(id) ON DELETE RESTRICT,
  CONSTRAINT "lr_pros_eventos_lote_id_fkey" FOREIGN KEY (lote_id) REFERENCES lr_pros_lotes(id) ON DELETE RESTRICT,
  CONSTRAINT "lr_pros_eventos_pkey" PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS lr_pros_candidatos_filtros ON public.lr_pros_candidatos USING btree (estado, verificacion, afinidad DESC);
CREATE INDEX IF NOT EXISTS lr_pros_empresas_ambiguos_idx ON public.lr_pros_empresas USING btree (nombre_normalizado, dominio_normalizado);
CREATE UNIQUE INDEX IF NOT EXISTS lr_pros_empresas_linkedin_idx ON public.lr_pros_empresas USING btree (linkedin_url) WHERE (linkedin_url IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS lr_pros_personas_linkedin_idx ON public.lr_pros_personas USING btree (linkedin_url) WHERE (linkedin_url IS NOT NULL);
DO $pol$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['lr_pros_lotes','lr_pros_empresas','lr_pros_personas','lr_pros_vinculos','lr_pros_candidatos','lr_pros_evidencias','lr_pros_eventos'] LOOP
EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
EXECUTE format('DROP POLICY IF EXISTS lectura_lr_prospeccion ON public.%I',t);
EXECUTE format('CREATE POLICY lectura_lr_prospeccion ON public.%I FOR SELECT TO authenticated USING (public.is_lr_suite_pending_user())',t);
END LOOP; END $pol$;
CREATE OR REPLACE FUNCTION public.lr_pros_importar(p_documento jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
declare
 v_clave text; v_fuente text; v_firma text; v_lote public.lr_pros_lotes%rowtype;
 v_item jsonb; v_emp jsonb; v_per jsonb; v_vin jsonb; v_ev jsonb; v_evs jsonb;
 v_empresa uuid; v_persona uuid; v_vinculo uuid; v_candidato uuid;
 v_url_emp text; v_url_per text; v_web text; v_dominio text; v_nombre text; v_nombre_norm text;
 v_id_externo text; v_ambiguo boolean; v_errores jsonb:='[]'::jsonb;
 v_resultados jsonb:='[]'::jsonb; v_count integer:=0;
 v_evidencias_cantidad integer; v_tiene_empresa boolean; v_tiene_responsable boolean;
 v_dimension text; v_max integer; v_nivel text; v_puntos integer; v_detalle jsonb;
 v_score integer; v_verificacion text; v_justifica boolean; v_ref text; v_tiene_anuncio_reciente boolean;
 v_estado text; v_cargo text; v_fecha date;
begin
 if not public.is_lr_suite_pending_user() or auth.uid() is null then
   raise exception 'No autorizado' using errcode='42501';
 end if;
 if jsonb_typeof(p_documento) <> 'object' or p_documento->>'schema_version' <> '1.0'
    or jsonb_typeof(p_documento->'candidates') <> 'array' then
   raise exception 'Contrato de importación inválido (schema_version=1.0)';
 end if;
 if jsonb_array_length(p_documento->'candidates')<1 or jsonb_array_length(p_documento->'candidates')>100 then
   raise exception 'El lote debe contener entre 1 y 100 candidatos';
 end if;
 v_clave:=nullif(btrim(p_documento->>'batch_id'),'');
 v_fuente:=nullif(btrim(p_documento->>'source'),'');
 if v_clave is null or length(v_clave)>120 or v_fuente is null or length(v_fuente)>120 then
    raise exception 'batch_id/source obligatorios (máximo 120 caracteres)';
 end if;
 v_firma:=md5(p_documento::text);
 perform pg_advisory_xact_lock(hashtextextended(v_fuente||':'||v_clave,0));
 select * into v_lote from public.lr_pros_lotes where clave=v_clave and procedencia=v_fuente for update;
 if found then
   if v_lote.firma<>v_firma then raise exception 'batch_id existente con contenido diferente; utilice uno nuevo'; end if;
   if v_lote.estado='terminado' then
     return jsonb_build_object('batch_id',v_clave,'reimported',true,'results',v_lote.resultados);
   end if;
 else
   insert into public.lr_pros_lotes(clave,procedencia,firma)
    values(v_clave,v_fuente,v_firma) returning * into v_lote;
 end if;
 for v_item in select value from jsonb_array_elements(p_documento->'candidates') loop
 begin
   if jsonb_typeof(v_item)<>'object' then raise exception 'Un candidato debe ser un objeto'; end if;
   v_id_externo:=nullif(btrim(v_item->>'external_id'),'');
   if v_id_externo is null or length(v_id_externo)>120 then raise exception 'external_id inválido'; end if;
   if exists(select 1 from public.lr_pros_candidatos where lote_id=v_lote.id and id_externo=v_id_externo) then
     raise exception 'external_id duplicado dentro del lote: %',v_id_externo;
   end if;
   v_emp:=v_item->'company'; v_per:=v_item->'person'; v_vin:=v_item->'relation';
   if jsonb_typeof(v_emp)<>'object' then raise exception 'company es obligatorio'; end if;
   v_nombre:=nullif(btrim(v_emp->>'name'),'');
   if v_nombre is null or length(v_nombre)>200 or length(v_nombre)<2 then raise exception 'company.name inválido'; end if;
   if (v_emp->>'segment') not in ('retail_ecommerce','servicios_leads') then raise exception 'company.segment inválido'; end if;
   v_nombre_norm:=regexp_replace(lower(v_nombre),'\s+',' ','g');
   v_url_emp:=public.lr_pros_linkedin_normalizada(v_emp->>'linkedin_url','company');
   v_web:=nullif(btrim(v_emp->>'website'),'');
   if v_web is not null and (length(v_web)>1200 or v_web !~* '^https?://') then raise exception 'company.website requiere URL completa HTTP(S)'; end if;
   v_dominio:=public.lr_pros_dominio(v_web);
   v_empresa:=null;v_ambiguo:=false;
   if v_url_emp is not null then
     select id into v_empresa from public.lr_pros_empresas where linkedin_url=v_url_emp;
   end if;
   if v_empresa is null then
     select exists(select 1 from public.lr_pros_empresas
       where nombre_normalizado=v_nombre_norm and dominio_normalizado is not distinct from v_dominio)
       into v_ambiguo;
     insert into public.lr_pros_empresas(nombre,nombre_normalizado,segmento,web,dominio_normalizado,linkedin_url,posible_duplicado_de)
       values(v_nombre,v_nombre_norm,v_emp->>'segment',v_web,v_dominio,v_url_emp,
        (select id from public.lr_pros_empresas
         where nombre_normalizado=v_nombre_norm and dominio_normalizado is not distinct from v_dominio
         order by creado_en limit 1)) returning id into v_empresa;
   end if;
   v_persona:=null;v_vinculo:=null;v_url_per:=null;
   if v_per is not null and v_per<>'null'::jsonb then
     if jsonb_typeof(v_per)<>'object' then raise exception 'person debe ser objeto o null'; end if;
     v_url_per:=public.lr_pros_linkedin_normalizada(v_per->>'linkedin_url','in');
     if nullif(btrim(v_per->>'first_name'),'') is null and nullif(btrim(v_per->>'last_name'),'') is null and v_url_per is null then
       raise exception 'person sin datos: utilice null para persona desconocida';
     end if;
     if length(coalesce(v_per->>'first_name',''))>120 or length(coalesce(v_per->>'last_name',''))>150 then
        raise exception 'Nombre de persona demasiado largo'; end if;
     if v_url_per is not null then
       select id into v_persona from public.lr_pros_personas where linkedin_url=v_url_per;
     else
       -- El nombre no constituye identidad: no fusionar por nombre; revisar potenciales homónimos.
       if exists(select 1 from public.lr_pros_personas
         where lower(coalesce(nombre,''))=lower(coalesce(v_per->>'first_name',''))
           and lower(coalesce(apellido,''))=lower(coalesce(v_per->>'last_name',''))) then
         v_ambiguo:=true;
       end if;
     end if;
     if v_persona is null then
       insert into public.lr_pros_personas(nombre,apellido,linkedin_url)
       values(nullif(btrim(v_per->>'first_name'),''),nullif(btrim(v_per->>'last_name'),''),v_url_per)
       returning id into v_persona;
     end if;
     v_cargo:=nullif(btrim(v_vin->>'job_title'),'');
     if length(coalesce(v_cargo,''))>180 then raise exception 'Cargo demasiado largo'; end if;
     v_fecha:=nullif(v_vin->>'verified_at','')::date;
     select id into v_vinculo from public.lr_pros_vinculos where empresa_id=v_empresa and persona_id=v_persona;
     if v_vinculo is null then
       insert into public.lr_pros_vinculos(empresa_id,persona_id,cargo,fuente,verificado_en)
        values(v_empresa,v_persona,v_cargo,
          left(nullif(btrim(v_vin->>'source_url'),''),700),v_fecha)
         returning id into v_vinculo;
     end if;
   end if;
   v_evs:=coalesce(v_item->'evidence','[]'::jsonb);
   if jsonb_typeof(v_evs)<>'array' or jsonb_array_length(v_evs)>30 then
     raise exception 'evidence debe ser una lista de máximo 30'; end if;
   v_evidencias_cantidad:=0;v_tiene_empresa:=false;v_tiene_responsable:=false;
   v_tiene_anuncio_reciente:=false;
   for v_ev in select value from jsonb_array_elements(v_evs) loop
     if jsonb_typeof(v_ev)<>'object' then raise exception 'Evidencia inválida'; end if;
     if (v_ev->>'subject') not in ('empresa','persona','vinculo')
       or (v_ev->>'dimension') not in ('afinidad','operacion','canal','publicidad','oportunidad','responsable')
       or coalesce(length(v_ev->>'field'),0) not between 1 and 100
       or coalesce(length(v_ev->>'fact'),0) not between 5 and 600
       or coalesce(length(v_ev->>'ref'),0) not between 1 and 100
       or coalesce(length(v_ev->>'url'),0) not between 12 and 1200
       or (v_ev->>'url') !~* '^https://[^[:space:]]+$'
       or (v_ev->>'url') ~* '^https://[^/]*@' then
       raise exception 'Evidencia requiere ref, sujeto, dimensión, campo, hecho y URL https exacta';
     end if;
     v_fecha:=(v_ev->>'checked_at')::date;
     if v_fecha is null or v_fecha>current_date then raise exception 'checked_at debe ser una fecha válida no futura'; end if;
     if nullif(v_ev->>'observed_at','') is not null
       and (v_ev->>'observed_at')::date>current_date then
       raise exception 'observed_at no puede ser futura'; end if;
     v_evidencias_cantidad:=v_evidencias_cantidad+1;
     if v_ev->>'subject'='empresa' then v_tiene_empresa:=true; end if;
     if v_ev->>'dimension'='responsable' and v_ev->>'subject' in ('persona','vinculo')
        then v_tiene_responsable:=true; end if;
     if v_ev->>'dimension'='publicidad' and nullif(v_ev->>'observed_at','') is not null
       and (v_ev->>'observed_at')::date >= current_date-interval '90 days' then
       v_tiene_anuncio_reciente:=true; end if;
   end loop;
   v_score:=0;v_detalle:='{}'::jsonb;
   for v_dimension,v_max in
     select * from (values ('afinidad',25),('operacion',15),('canal',15),('publicidad',15),('oportunidad',15),('responsable',15)) t(d,m)
   loop
     v_nivel:=coalesce(v_item->'assessment'->v_dimension->>'level','unknown');
     if v_nivel not in ('unknown','partial','full') then raise exception 'Nivel de calificación inválido para %',v_dimension; end if;
     v_justifica:=false;
     if v_nivel<>'unknown' then
       for v_ev in select value from jsonb_array_elements(v_evs) loop
         if v_ev->>'dimension'=v_dimension and jsonb_typeof(v_item->'assessment'->v_dimension->'evidence_refs')='array'
           and (v_item->'assessment'->v_dimension->'evidence_refs') ? (v_ev->>'ref') then
           v_justifica:=true;exit;
         end if;
       end loop;
     end if;
     if v_dimension='publicidad' and not v_tiene_anuncio_reciente then v_justifica:=false; end if;
     if v_dimension='responsable' and (v_persona is null or not v_tiene_responsable) then v_justifica:=false; end if;
     v_puntos:=case when not v_justifica then 0 when v_nivel='full' then v_max else ceil(v_max::numeric/2)::integer end;
     v_score:=v_score+v_puntos;
     v_detalle:=v_detalle||jsonb_build_object(v_dimension,jsonb_build_object(
       'points',v_puntos,'max',v_max,'evidence_supported',v_justifica,
       'unknown',not v_justifica,'claimed_level',v_nivel));
   end loop;
   v_verificacion:=case when v_evidencias_cantidad=0 then 'sin_evidencia'
     when v_tiene_empresa and v_tiene_responsable and v_url_per is not null then 'documentada'
     else 'parcial' end;
   v_estado:=case when v_ambiguo then 'requiere_revision' else 'pendiente' end;
   insert into public.lr_pros_candidatos(lote_id,id_externo,empresa_id,persona_id,vinculo_id,estado,afinidad,desglose,verificacion)
    values(v_lote.id,v_id_externo,v_empresa,v_persona,v_vinculo,v_estado,v_score,v_detalle,v_verificacion)
    returning id into v_candidato;
   for v_ev in select value from jsonb_array_elements(v_evs) loop
     insert into public.lr_pros_evidencias(candidato_id,referencia,sujeto,dimension,campo,url,consultado_en,observado_en,hecho)
       values(v_candidato,v_ev->>'ref',v_ev->>'subject',v_ev->>'dimension',v_ev->>'field',v_ev->>'url',
         (v_ev->>'checked_at')::date,nullif(v_ev->>'observed_at','')::date,v_ev->>'fact');
   end loop;
   insert into public.lr_pros_eventos(lote_id,candidato_id,tipo,detalle)
    values(v_lote.id,v_candidato,'importado',jsonb_build_object('external_id',v_id_externo,'afinidad',v_score,'ambiguo',v_ambiguo));
   v_resultados:=v_resultados||jsonb_build_array(jsonb_build_object('external_id',v_id_externo,'status','created','candidate_id',v_candidato,'score',v_score,'review_required',v_ambiguo));
 exception when others then
   v_resultados:=v_resultados||jsonb_build_array(jsonb_build_object('external_id',coalesce(v_item->>'external_id','?'),
       'status','error','message',left(sqlerrm,300)));
 end;
 end loop;
 update public.lr_pros_lotes set resultados=v_resultados,estado='terminado',terminado_en=now() where id=v_lote.id;
 insert into public.lr_pros_eventos(lote_id,tipo,detalle) values(v_lote.id,'lote_terminado',jsonb_build_object('total',jsonb_array_length(v_resultados)));
 return jsonb_build_object('batch_id',v_clave,'reimported',false,'results',v_resultados);
end $function$

CREATE OR REPLACE FUNCTION public.lr_pros_revisar(p_candidato uuid, p_estado text, p_notas text DEFAULT ''::text, p_revision_anterior timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
declare v public.lr_pros_candidatos%rowtype;
begin
 if not public.is_lr_suite_pending_user() or auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_estado not in ('pendiente','requiere_revision','validado','rechazado') or length(coalesce(p_notas,''))>2000 then
    raise exception 'Estado o notas inválidos'; end if;
 select * into v from public.lr_pros_candidatos where id=p_candidato for update;
 if not found then raise exception 'Candidato no encontrado'; end if;
 if v.revisado_en is distinct from p_revision_anterior then
    raise exception 'El candidato fue revisado por otro usuario; actualice la bandeja antes de guardar'; end if;
 if v.promovido_en is not null and p_estado<>'validado' then raise exception 'No se puede desvalidar un candidato promovido'; end if;
 if p_estado='validado' and v.verificacion='sin_evidencia' then
    raise exception 'Revise al menos una evidencia antes de validar'; end if;
 update public.lr_pros_candidatos set estado=p_estado,notas_revision=coalesce(p_notas,''),
   revisado_por=auth.uid(),revisado_en=clock_timestamp() where id=p_candidato;
 insert into public.lr_pros_eventos(candidato_id,lote_id,tipo,detalle)
    values(p_candidato,v.lote_id,'revisado',jsonb_build_object('previous',v.estado,'next',p_estado));
 return jsonb_build_object('id',p_candidato,'status',p_estado);
end $function$

CREATE OR REPLACE FUNCTION public.lr_pros_promover(p_candidato uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
declare v public.lr_pros_candidatos%rowtype; p public.lr_pros_personas%rowtype;
 e public.lr_pros_empresas%rowtype; vinc public.lr_pros_vinculos%rowtype;
 v_destino uuid; v_existente uuid;
begin
 if not public.is_lr_suite_pending_user() or auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
 select * into v from public.lr_pros_candidatos where id=p_candidato for update;
 if not found then raise exception 'Candidato no encontrado'; end if;
 if v.estado<>'validado' then raise exception 'Requiere validación humana explícita'; end if;
 if v.verificacion<>'documentada' then raise exception 'Para promover falta evidencia documental de empresa y responsable'; end if;
 if v.prospecto_id is not null then return jsonb_build_object('status','already_promoted','prospect_id',v.prospecto_id); end if;
 if v.persona_id is null then raise exception 'Falta persona: no se puede promover una empresa sin responsable'; end if;
 select * into p from public.lr_pros_personas where id=v.persona_id;
 if p.linkedin_url is null then raise exception 'Falta URL canónica de LinkedIn: se requiere vinculación manual para evitar duplicados'; end if;
 perform pg_advisory_xact_lock(hashtextextended('promote:'||p.linkedin_url,0));
 select * into e from public.lr_pros_empresas where id=v.empresa_id;
 select * into vinc from public.lr_pros_vinculos where id=v.vinculo_id;
 -- El seguimiento existente tiene índice único sobre lower(linkedin_url), pero puede
 -- contener URL con query o slash; comparar también la versión normalizada.
 select id into v_existente from public.lr_suite_prospectos
   where case when lower(linkedin_url) ~ '^https?://(www\.)?linkedin\.com/in/'
     then regexp_replace(regexp_replace(lower(split_part(split_part(linkedin_url,'?',1),'#',1)),
       '^https?://(www\.)?linkedin\.com/', 'https://www.linkedin.com/'), '/+$', '')
     else null end = p.linkedin_url
   limit 1;
 if v_existente is not null then
    return jsonb_build_object('status','existing_contact_manual_review','prospect_id',v_existente);
 end if;
 insert into public.lr_suite_prospectos(nombre,apellido,linkedin_url,web,empresa,cargo,
   estado,notas,creado_por)
 values(coalesce(p.nombre,''),coalesce(p.apellido,''),p.linkedin_url,coalesce(e.web,''),e.nombre,
        coalesce(vinc.cargo,''),'por_contactar','',coalesce(auth.jwt()->>'email',''))
 returning id into v_destino;
 update public.lr_pros_candidatos set prospecto_id=v_destino,promovido_en=now() where id=p_candidato;
 insert into public.lr_pros_eventos(candidato_id,lote_id,tipo,detalle)
 values(p_candidato,v.lote_id,'promovido',jsonb_build_object('prospect_id',v_destino));
 return jsonb_build_object('status','promoted','prospect_id',v_destino);
end $function$

REVOKE ALL ON FUNCTION public.lr_pros_dominio(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_dominio(text) TO authenticated;
REVOKE ALL ON FUNCTION public.lr_pros_linkedin_normalizada(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_linkedin_normalizada(text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.lr_pros_importar(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_importar(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.lr_pros_revisar(uuid,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_revisar(uuid,text,text,timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.lr_pros_promover(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_promover(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
