-- Prospectos de la Ads Library: el cuarto origen del ACRM.
--
-- La prospección semanal (hoja «Prospección comercial – Lima Retail») no sale de LinkedIn ni de un
-- anuncio propio: se buscan empresas que pautan en Perú, se comprueba su pauta en el Centro de
-- Transparencia de Google y en la Biblioteca de Anuncios de Meta, y recién entonces se busca a la
-- persona responsable. Esas empresas y esas personas no tenían cómo entrar al ACRM: un lead se
-- estrenaba por su Connections.csv (canal linkedin), por un WhatsApp de pauta (meta_whatsapp) o
-- inventándole una cotización (directo, que entra ya en «cotizado» y por tanto miente el embudo).
-- Se cargaban a mano, de uno en uno, o se quedaban en la hoja.
--
-- Esta migración abre el canal 'ads_library' —lo que la tabla maestra enseña como «Ads Library»— y
-- una función para dar de alta un prospecto con lo que la hoja ya sabe de él: empresa, dominio,
-- nombre, cargo, rubro y la pregunta comercial. El lead entra en «Sin tocar», como cualquier otro
-- capturado, y de ahí lo mueve la ficha con sus hitos.
--
-- La clave de la captura sigue la convención de los demás canales: 'li:<perfil>' cuando se conoce el
-- perfil público de la persona —así la ficha enseña su enlace, la reserva del primer contacto
-- funciona igual y el Connections.csv que llegue después no lo duplica— y 'ads:<dominio>' cuando
-- todavía no hay persona identificada, que es el estado normal de media hoja.
--
-- No toca lr_acrm_operar ni lr_acrm_datos: el alta tiene su propia función, así que nada de lo que
-- ya mueve etapas, mensajes, cotizaciones y datos se reescribe aquí.
BEGIN;

-- El cuarto canal. El orden del CHECK es el de antigüedad, no el de importancia.
ALTER TABLE public.lr_acrm_capturas DROP CONSTRAINT IF EXISTS lr_acrm_capturas_canal_check;
ALTER TABLE public.lr_acrm_capturas ADD CONSTRAINT lr_acrm_capturas_canal_check
 CHECK (canal IN ('linkedin','meta_whatsapp','directo','ads_library'));

-- Alta de un prospecto de la hoja. Escribe cualquier cuenta habilitada, como el resto del ACRM.
--
-- Lo que ya existe no se pisa: si el perfil estaba en el ACRM (porque alguien subió su
-- Connections.csv), conserva su canal y su fecha de captura, y la hoja solo le rellena los huecos
-- —rubro, empresa, web, cargo—. Volver a importar la misma hoja no duplica leads ni borra lo que
-- alguien corrigió a mano en la tabla.
CREATE OR REPLACE FUNCTION private.lr_acrm_prospecto(p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_uid uuid:=auth.uid();
 v_perfil text; v_web text; v_dominio text; v_clave text; v_nombre text; v_empresa text; v_existe boolean; v_previo text;
BEGIN
 IF v_uid IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN
  RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501';
 END IF;
 v_nombre:=left(btrim(coalesce(p_datos->>'nombre','')),300);
 v_empresa:=left(btrim(coalesce(p_datos->>'empresa','')),200);
 -- La web se guarda completa (https://…) y el dominio es lo que distingue a una empresa de otra:
 -- es lo que la tabla enseña y lo que da la clave cuando no hay persona identificada.
 v_web:=btrim(coalesce(p_datos->>'web',''));
 v_web:=regexp_replace(v_web,'/+$','');
 IF v_web<>'' AND v_web !~* '^https?://' THEN v_web:='https://'||v_web; END IF;
 v_dominio:=lower(regexp_replace(v_web,'^https?://(www\.)?','','i'));
 v_dominio:=split_part(v_dominio,'/',1);
 -- El perfil llega ya normalizado por la pantalla (perfilLinkedin), pero se vuelve a comprobar aquí:
 -- la clave de un lead se arma con él y una URL cualquiera dejaría un lead imposible de encontrar.
 v_perfil:=lower(btrim(coalesce(p_datos->>'linkedin','')));
 IF v_perfil<>'' AND v_perfil !~ '^https://www\.linkedin\.com/in/[a-z0-9][a-z0-9_.%-]{1,180}$' THEN
  RAISE EXCEPTION 'El perfil tiene que ser una URL de linkedin.com/in/…: %',v_perfil;
 END IF;
 IF v_perfil<>'' THEN
  v_clave:='li:'||v_perfil;
 ELSE
  -- Sin perfil, el prospecto se identifica por el dominio de la empresa, que es único. Si tampoco
  -- hay dominio se usa el nombre de la empresa, y si falta todo no hay a quién dar de alta.
  IF v_dominio='' THEN v_dominio:=btrim(regexp_replace(lower(v_empresa),'[^a-z0-9]+','-','g'),'-'); END IF;
  IF v_dominio='' THEN RAISE EXCEPTION 'Un prospecto necesita al menos su dominio o el nombre de la empresa'; END IF;
  v_clave:='ads:'||left(v_dominio,400);
  -- Dos personas de la misma empresa son dos prospectos, así que el nombre entra en la clave... pero
  -- la semana en que la hoja todavía no tenía a nadie, el prospecto se dio de alta a nombre de la
  -- empresa. Cuando aparece la persona, ese lead se convierte en ella en vez de dejar un duplicado
  -- en «Sin tocar»; si alguien ya lo tocó, no se le cambia el nombre debajo y la persona entra aparte.
  IF v_nombre<>'' THEN
   SELECT x.nombre INTO v_previo FROM public.lr_acrm_capturas x
    JOIN public.lr_acrm_embudo e ON e.captura=x.clave
    WHERE x.clave=v_clave AND x.canal='ads_library' AND e.etapa='nuevo'
      AND x.nombre IN (v_empresa,v_dominio);
   IF v_previo IS NULL THEN
    v_clave:=left(v_clave||'-'||btrim(regexp_replace(lower(v_nombre),'[^a-z0-9]+','-','g'),'-'),480);
   END IF;
  END IF;
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.lr_acrm_capturas WHERE clave=v_clave) INTO v_existe;
 -- A falta de persona, el prospecto es la empresa y así se lee en la tabla: un «por identificar» en
 -- la columna del cliente no dice de quién se trata.
 IF coalesce(nullif(v_nombre,''),nullif(v_empresa,''),v_dominio)='' THEN
  RAISE EXCEPTION 'Un prospecto necesita al menos su nombre, su empresa o su dominio';
 END IF;
 INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en,consulta,rubro,empresa,web)
 VALUES(v_clave,'ads_library',
  coalesce(nullif(v_nombre,''),nullif(v_empresa,''),v_dominio),
  now(),
  left(btrim(coalesce(p_datos->>'consulta','')),2000),
  left(btrim(coalesce(p_datos->>'rubro','')),120),
  v_empresa,
  left(v_web,300))
 ON CONFLICT(clave) DO UPDATE SET
  -- El canal y la fecha de captura de un lead que ya existía no se tocan: su origen es el de verdad.
  -- El nombre solo cambia en un sentido: el prospecto que estaba a nombre de la empresa pasa a
  -- nombre de la persona que la hoja acaba de identificar. Nunca al revés, ni sobre otra persona.
  nombre=CASE WHEN v_nombre<>'' AND lr_acrm_capturas.nombre IN ('',v_empresa,v_dominio)
              THEN v_nombre ELSE lr_acrm_capturas.nombre END,
  consulta=CASE WHEN lr_acrm_capturas.consulta='' THEN excluded.consulta ELSE lr_acrm_capturas.consulta END,
  rubro=CASE WHEN lr_acrm_capturas.rubro='' THEN excluded.rubro ELSE lr_acrm_capturas.rubro END,
  empresa=CASE WHEN lr_acrm_capturas.empresa='' THEN excluded.empresa ELSE lr_acrm_capturas.empresa END,
  web=CASE WHEN lr_acrm_capturas.web='' THEN excluded.web ELSE lr_acrm_capturas.web END;
 RETURN jsonb_build_object('ok',true,'clave',v_clave,'nuevo',NOT v_existe);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_prospecto(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_prospecto(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.lr_acrm_prospecto(p_datos jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.lr_acrm_prospecto(p_datos);
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_prospecto(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_prospecto(jsonb) TO authenticated;

-- El marcador del mes cuenta también el nuevo canal: si no, los prospectos de la hoja que alguien
-- contacte este mes no aparecerían en ninguna fila del embudo. Es la misma función de
-- 20261110010000 con el canal añadido a su lista.
CREATE OR REPLACE FUNCTION public.lr_acrm_marcador(p_mes date) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
WITH limites AS (
 SELECT date_trunc('month',p_mes)::date AS inicio,(date_trunc('month',p_mes)+interval '1 month')::date AS fin,
 (now() AT TIME ZONE 'America/Lima')::date AS hoy
), rango AS (
 SELECT (inicio::timestamp AT TIME ZONE 'America/Lima') AS desde,(fin::timestamp AT TIME ZONE 'America/Lima') AS hasta,hoy FROM limites
), vivos AS (
 SELECT e.*,x.canal FROM public.lr_acrm_embudo e JOIN public.lr_acrm_capturas x ON x.clave=e.captura
), canales AS (
 SELECT c.canal,
  count(*) FILTER(WHERE v.contactado_en>=r.desde AND v.contactado_en<r.hasta)::int AS contactados,
  count(*) FILTER(WHERE v.respondio_en>=r.desde AND v.respondio_en<r.hasta)::int AS respondieron,
  count(*) FILTER(WHERE v.cotizado_en>=r.desde AND v.cotizado_en<r.hasta)::int AS cotizados,
  count(*) FILTER(WHERE v.etapa='ganado' AND v.cerrado_en>=r.desde AND v.cerrado_en<r.hasta)::int AS ganados,
  count(*) FILTER(WHERE v.etapa='perdido' AND v.cerrado_en>=r.desde AND v.cerrado_en<r.hasta)::int AS perdidos,
  coalesce(sum(v.monto) FILTER(WHERE v.etapa='ganado' AND v.cerrado_en>=r.desde AND v.cerrado_en<r.hasta),0)::numeric AS monto_ganado,
  coalesce(sum(v.monto) FILTER(WHERE v.cotizado_en>=r.desde AND v.cotizado_en<r.hasta),0)::numeric AS monto_cotizado,
  count(*) FILTER(WHERE v.etapa='nuevo')::int AS sin_tocar
 FROM (SELECT unnest(ARRAY['linkedin','meta_whatsapp','directo','ads_library']) AS canal) c
 CROSS JOIN rango r LEFT JOIN vivos v ON v.canal=c.canal
 GROUP BY c.canal
), dias AS (
 SELECT m.autor,(m.enviado_en AT TIME ZONE 'America/Lima')::date AS dia
 FROM public.lr_acrm_mensajes m WHERE m.direccion='enviado' AND m.autor IS NOT NULL
 GROUP BY 1,2
), tramos AS (
 SELECT autor,dia,dia-(row_number() OVER(PARTITION BY autor ORDER BY dia))::int AS grupo FROM dias
), rachas AS (
 SELECT t.autor,max(t.dia) AS fin,count(*)::int AS largo FROM tramos t GROUP BY t.autor,t.grupo
), personas AS (
 SELECT p.usuario_id,p.nombre,
  coalesce(count(m.id) FILTER(WHERE m.enviado_en>=r.desde AND m.enviado_en<r.hasta),0)::int AS mensajes,
  coalesce(count(DISTINCT m.captura) FILTER(WHERE m.enviado_en>=r.desde AND m.enviado_en<r.hasta),0)::int AS prospectos,
  coalesce((SELECT max(largo) FROM rachas ra WHERE ra.autor=p.usuario_id AND ra.fin>=r.hoy-1),0)::int AS racha,
  (SELECT max(dia) FROM dias d WHERE d.autor=p.usuario_id) AS ultimo_dia
 FROM public.lr_pros_colaboradores p CROSS JOIN rango r
 LEFT JOIN public.lr_acrm_mensajes m ON m.autor=p.usuario_id AND m.direccion='enviado'
 WHERE p.activo GROUP BY p.usuario_id,p.nombre,r.desde,r.hasta,r.hoy
), cierres AS (
 SELECT e.actualizado_por AS usuario,
  count(*) FILTER(WHERE e.etapa='cotizado' AND e.cotizado_en>=r.desde AND e.cotizado_en<r.hasta)::int AS cotizados,
  count(*) FILTER(WHERE e.etapa='ganado' AND e.cerrado_en>=r.desde AND e.cerrado_en<r.hasta)::int AS ganados
 FROM public.lr_acrm_embudo e CROSS JOIN rango r WHERE e.actualizado_por IS NOT NULL GROUP BY e.actualizado_por
)
SELECT jsonb_build_object(
 'mes',to_char(date_trunc('month',p_mes),'YYYY-MM'),
 'canales',(SELECT coalesce(jsonb_agg(to_jsonb(canales) ORDER BY canal),'[]'::jsonb) FROM canales),
 'personas',(SELECT coalesce(jsonb_agg(to_jsonb(personas)||jsonb_build_object(
   'cotizados',coalesce((SELECT cotizados FROM cierres WHERE usuario=personas.usuario_id),0),
   'ganados',coalesce((SELECT ganados FROM cierres WHERE usuario=personas.usuario_id),0))
   ORDER BY personas.mensajes DESC,personas.nombre),'[]'::jsonb) FROM personas)
);
$fn$;

COMMIT;
