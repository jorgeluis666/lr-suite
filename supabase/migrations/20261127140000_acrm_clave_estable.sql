-- Que llenar una columna de la hoja no parta un lead en dos.
--
-- La clave de un prospecto de la hoja se arma con el primer dato que lo identifica: su dominio si lo
-- tiene, y si no el nombre de su empresa, y si no su teléfono, y si no su correo. Eso funciona
-- mientras la fila no cambie. Pero la pestaña Contactos es un documento que se va llenando: el 27 de
-- noviembre de 2026 alguien completó «Dominio clave» en 609 de las filas que vinieron del CRM de
-- Tierra Films, donde el día anterior había 38.
--
-- Para el alta, esos 572 contactos eran otras personas:
--
--   ayer   ads:a-la-pepa-s-a-c-carla-zuniga      (sin dominio: la clave la puso la empresa)
--   hoy    ads:alapepa.com-carla-zuniga          (con dominio: la clave la pone el dominio)
--
-- El barrido siguiente los habría dado de alta otra vez, con la clave nueva, y los de ayer se
-- quedarían ahí para siempre: 572 contactos repetidos y ninguna forma de saber cuál de los dos
-- mirar. Y volvería a pasar con las 694 filas que todavía no tienen dominio.
--
-- Lo que cambia: antes de dar de alta con la clave que le toca, se mira si esa misma persona ya está
-- guardada con la clave que le habría tocado con otro de sus datos. Si está, se reutiliza. El lead
-- se queda donde está —con su etapa, sus mensajes y su cotización— y lo que la hoja trae de nuevo
-- entra en sus campos, que es lo que hacía falta.
--
-- Lo que NO cambia:
--   · La clave que se elige para un prospecto nuevo. Un contacto que entra hoy por primera vez se
--     guarda igual que antes, con su dominio si lo trae.
--   · Las claves que ya existen. Esta migración no renombra nada: no puede, porque el embudo, los
--     mensajes y las cotizaciones cuelgan de la clave. Los 572 de arriba se quedan con la que
--     tienen, que es un identificador interno y no se ve en ninguna pantalla.
--   · Un prospecto con perfil de LinkedIn sigue usando «li:<url>», que no depende de nada de esto.
--
-- Por qué se compara el canal: dos personas distintas pueden compartir un número (pasa en el CRM de
-- Tierra Films, con centralitas y oficinas), pero una fila de la hoja y lo que ya está guardado solo
-- son el mismo lead si además vienen del mismo sitio.
BEGIN;

CREATE OR REPLACE FUNCTION private.lr_acrm_prospecto_guardar(p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_perfil text; v_web text; v_dominio text; v_clave text; v_nombre text; v_empresa text;
 v_canal text; v_tel text; v_tel_texto text; v_correo text; v_rotulo text;
 v_existe boolean; v_previo text; v_bases text[]; v_apodo text; v_emp text; v_cand text; i int;
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
 -- El id interno (ACoAAA…) pasa el formato de arriba pero no lleva a ninguna parte (20261124180000).
 IF v_perfil ~ '^https://www\.linkedin\.com/in/acoaa[a-z0-9_-]{20,}$' THEN
  RAISE EXCEPTION 'Ese enlace es el identificador interno de LinkedIn y no abre el perfil: hace falta su dirección pública (linkedin.com/in/nombre-apellido): %',v_perfil;
 END IF;
 v_canal:=private.lr_pros_canal(p_datos->>'origen');
 -- El teléfono se guarda como lo guarda lr_acrm_datos: solo dígitos y con el 51 delante si es un
 -- celular peruano de nueve. Así el mismo número escrito a mano en la ficha y traído de la hoja es
 -- el mismo, y claveWhatsapp() arma con él el wa:0:<número> con el que el bot lee la conversación.
 -- Lo que no deja un número usable se deja en blanco y la fila entra igual: una lista trae teléfonos
 -- a medias, y perder el contacto entero por eso sería peor.
 v_tel_texto:=left(btrim(coalesce(p_datos->>'telefono','')),40);
 v_tel:=regexp_replace(v_tel_texto,'[^0-9]','','g');
 IF v_tel ~ '^9[0-9]{8}$' THEN v_tel:='51'||v_tel; END IF;
 IF v_tel !~ '^[0-9]{7,20}$' THEN v_tel:=''; v_tel_texto:=''; END IF;
 v_correo:=left(lower(btrim(coalesce(p_datos->>'correo',''))),200);
 IF v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN v_correo:=''; END IF;
 IF v_perfil<>'' THEN
  v_clave:='li:'||v_perfil;
 ELSE
  -- Todo lo que identifica a este contacto, en el orden en que manda. El primero decide la clave de
  -- un prospecto nuevo; los demás son por dónde buscarlo si ya estaba guardado de otra manera.
  -- Las tildes se van antes de armar la clave: «Hernández» y «Hernandez» no son dos prospectos.
  v_bases:=ARRAY[]::text[];
  IF v_dominio<>'' THEN v_bases:=v_bases||v_dominio; END IF;
  v_emp:=btrim(regexp_replace(private.lr_pros_titulo(v_empresa),'[^a-z0-9]+','-','g'),'-');
  IF v_emp<>'' THEN v_bases:=v_bases||v_emp; END IF;
  -- Un contacto de una lista puede no traer ni empresa ni dominio. Lo que lo identifica es entonces
  -- su número, o su correo si no hay número: son los del CRM de Tierra Films que llegaron con el
  -- teléfono metido en la casilla de la empresa y nada más.
  IF v_tel<>'' THEN v_bases:=v_bases||('tel-'||v_tel); END IF;
  IF v_correo<>'' THEN
   v_bases:=v_bases||('correo-'||btrim(regexp_replace(v_correo,'[^a-z0-9]+','-','g'),'-'));
  END IF;
  IF coalesce(array_length(v_bases,1),0)=0 THEN
   RAISE EXCEPTION 'Un prospecto necesita al menos su dominio, el nombre de la empresa, un teléfono o un correo';
  END IF;
  v_dominio:=v_bases[1];
  v_apodo:=btrim(regexp_replace(private.lr_pros_titulo(v_nombre),'[^a-z0-9]+','-','g'),'-');
  v_clave:='ads:'||left(v_dominio,400);
  IF v_nombre<>'' THEN
   SELECT x.nombre INTO v_previo FROM public.lr_acrm_capturas x
    JOIN public.lr_acrm_embudo e ON e.captura=x.clave
    WHERE x.clave=v_clave AND x.canal=v_canal AND e.etapa='nuevo'
      AND x.nombre IN (v_empresa,v_dominio,v_tel_texto,v_correo);
   IF v_previo IS NULL THEN
    v_clave:=left(v_clave||'-'||v_apodo,480);
   END IF;
  END IF;
  -- La hoja se va llenando, y el dato que da la clave puede aparecer meses después del contacto: un
  -- dominio donde solo había el nombre de la empresa, un teléfono donde no había nada. Si la clave
  -- que toca hoy no existe pero sí la que habría tocado con otro de sus datos, es la misma persona y
  -- se reutiliza su lead, en vez de abrir uno nuevo al lado del que ya se está trabajando.
  IF NOT EXISTS(SELECT 1 FROM public.lr_acrm_capturas WHERE clave=v_clave) THEN
   -- Se empieza por el primero: su clave con nombre es la que acabamos de descartar, pero la que
   -- entró sin nombre y ya lleva el de esta persona —porque un barrido anterior las fundió— sigue
   -- siendo su lead. Pasó con las filas anónimas que traían solo un número.
   FOR i IN 1..coalesce(array_length(v_bases,1),1) LOOP
    IF v_nombre<>'' THEN
     v_cand:=left('ads:'||left(v_bases[i],400)||'-'||v_apodo,480);
     PERFORM 1 FROM public.lr_acrm_capturas WHERE clave=v_cand AND canal=v_canal;
     IF FOUND THEN v_clave:=v_cand; EXIT; END IF;
    END IF;
    -- O la que entró sin nombre —con la empresa o el número por rótulo— y es este contacto, igual
    -- que arriba. También vale la que ya lleva su nombre porque esta misma hoja se lo puso.
    v_cand:='ads:'||left(v_bases[i],400);
    PERFORM 1 FROM public.lr_acrm_capturas x WHERE x.clave=v_cand AND x.canal=v_canal
      AND (x.nombre IN ('',v_empresa,v_bases[i],v_tel_texto,v_correo)
           OR (v_nombre<>'' AND x.nombre=v_nombre));
    IF FOUND THEN v_clave:=v_cand; EXIT; END IF;
   END LOOP;
  END IF;
 END IF;
 -- Con qué nombre se le conoce en la tabla: la persona, su empresa, y si no hay ninguna de las dos,
 -- su número tal como lo escribe la hoja («954 358 483»), que se lee mejor que 51954358483.
 v_rotulo:=coalesce(nullif(v_nombre,''),nullif(v_empresa,''),nullif(v_tel_texto,''),nullif(v_correo,''),v_dominio);
 IF coalesce(v_rotulo,'')='' THEN
  RAISE EXCEPTION 'Un prospecto necesita al menos su nombre, su empresa, su dominio, su teléfono o su correo';
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.lr_acrm_capturas WHERE clave=v_clave) INTO v_existe;
 INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en,consulta,rubro,empresa,web,telefono,correo)
 VALUES(v_clave,v_canal,v_rotulo,now(),
  left(btrim(coalesce(p_datos->>'consulta','')),2000),
  left(btrim(coalesce(p_datos->>'rubro','')),120),
  v_empresa,
  left(v_web,300),
  v_tel,
  v_correo)
 ON CONFLICT(clave) DO UPDATE SET
  -- El que ya estaba por su Connections.csv pasa a ser un prospecto de la hoja: es lo que explica
  -- por qué está en la lista. Los demás orígenes no se tocan.
  canal=CASE WHEN lr_acrm_capturas.canal='linkedin' THEN v_canal ELSE lr_acrm_capturas.canal END,
  -- El rótulo provisional (la empresa, el dominio, el número) cede en cuanto la hoja trae la
  -- persona; un nombre que alguien escribió se queda.
  nombre=CASE WHEN v_nombre<>'' AND lr_acrm_capturas.nombre IN ('',v_empresa,v_dominio,v_tel_texto,v_correo)
              THEN v_nombre ELSE lr_acrm_capturas.nombre END,
  consulta=CASE WHEN lr_acrm_capturas.consulta='' THEN excluded.consulta ELSE lr_acrm_capturas.consulta END,
  rubro=CASE WHEN lr_acrm_capturas.rubro='' THEN excluded.rubro ELSE lr_acrm_capturas.rubro END,
  empresa=CASE WHEN lr_acrm_capturas.empresa='' THEN excluded.empresa ELSE lr_acrm_capturas.empresa END,
  -- El dominio que la hoja acaba de completar: es justo lo que hace falta para verificar su pauta en
  -- Meta y en Google Ads, los pasos 3 y 4 del proceso de prospección.
  web=CASE WHEN lr_acrm_capturas.web='' THEN excluded.web ELSE lr_acrm_capturas.web END,
  telefono=CASE WHEN lr_acrm_capturas.telefono='' THEN excluded.telefono ELSE lr_acrm_capturas.telefono END,
  correo=CASE WHEN lr_acrm_capturas.correo='' THEN excluded.correo ELSE lr_acrm_capturas.correo END;
 RETURN jsonb_build_object('ok',true,'clave',v_clave,'nuevo',NOT v_existe,'canal',v_canal);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_prospecto_guardar(jsonb) FROM PUBLIC,anon,authenticated;

COMMIT;
