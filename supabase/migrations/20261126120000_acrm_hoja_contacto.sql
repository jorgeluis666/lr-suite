-- La hoja de prospección manda el origen, el teléfono y el correo de cada contacto.
--
-- Hasta hoy el barrido de la hoja (20261123090000) leía siete columnas y daba de alta todo como
-- lead de «Ads Library». Eso valía mientras la pestaña Contactos fuera una sola lista: 265 filas de
-- empresas encontradas en la Biblioteca de Anuncios de Meta, todas del mismo sitio.
--
-- El 26 de noviembre de 2026 la pestaña pasó a tener dos listas, y lo dice su propia columna
-- «Origen»: las 265 de siempre y 1.325 que vienen del CRM de Tierra Films, con «Directo». No son lo
-- mismo y no se trabajan igual —a una empresa de Ads Library se le busca el responsable en LinkedIn;
-- a un contacto directo se le escribe—, así que entrar todas como «Ads Library» dejaba la Tabla
-- Maestra diciendo algo falso: 1.590 leads de la Biblioteca de Anuncios, cuando son 265.
--
-- Esas 1.325 filas tampoco traen perfil de LinkedIn (ninguna) y casi nunca dominio (38). Lo que
-- traen es un número (941) y un correo (674), que es justo por donde se les escribe, y las dos
-- columnas se quedaban fuera. Un lead así entraba sin forma de contacto: un nombre y nada más.
--
-- Esta migración hace tres cosas:
--
--   · lr_acrm_capturas gana la columna «correo». Va al lado de telefono (20261114110000), por la
--     misma razón que aquella: es un dato de calificación, anterior a cotizar, y hasta ahora el
--     correo de un lead solo existía si alguien le había hecho una cotización.
--   · private.lr_pros_campo reconoce «Origen», «Correo» y «Teléfono», y private.lr_pros_canal
--     traduce lo que la hoja dice del origen al canal de la tabla.
--   · private.lr_acrm_prospecto_guardar guarda los tres, y sabe dar de alta a quien no tiene
--     empresa ni dominio: si lo único que hay es su número o su correo, eso es lo que lo identifica.
--
-- Lo que NO cambia:
--   · La clave de un prospecto de la hoja sigue empezando por «ads:». Es el espacio de nombres de la
--     hoja, no su origen: los 270 leads que ya entraron tienen esa clave y cambiarla ahora los
--     duplicaría. Una fila con perfil sigue usando «li:<url>», que es la que comparte con el
--     Connections.csv.
--   · El origen que ya tiene un lead solo se reescribe si era «linkedin», igual que desde
--     20261124150000. Un lead de «meta_whatsapp» o «directo» existe porque esa persona escribió
--     ella: una hoja no lo cambia. Lo que sí cambia es con qué se reescribe: antes «ads_library»
--     siempre, ahora lo que diga la columna Origen de esa fila.
--
-- Después de aplicarla, para que las 1.325 entren: «Volver a traer todo» en el panel
-- «+ Prospectos de la hoja», o select private.lr_pros_hoja_sincronizar(true).
BEGIN;

-- ── El correo de un lead ───────────────────────────────────────────────────
ALTER TABLE public.lr_acrm_capturas ADD COLUMN IF NOT EXISTS correo text NOT NULL DEFAULT '';

-- Una dirección o nada. No se afina más: lo que entra lo escribe una función que ya descarta lo que
-- no tenga forma de correo, y una regla estricta acá solo serviría para que una fila de la hoja se
-- perdiera por un espacio de más.
ALTER TABLE public.lr_acrm_capturas DROP CONSTRAINT IF EXISTS lr_acrm_capturas_correo_formato;
ALTER TABLE public.lr_acrm_capturas ADD CONSTRAINT lr_acrm_capturas_correo_formato
 CHECK (correo = '' OR (length(correo) <= 200 AND correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));

-- ── Las columnas que la hoja puede traer ───────────────────────────────────
-- Tres títulos nuevos sobre los siete de 20261123090000. El título manda, no su posición: la
-- pestaña tiene dieciocho columnas y el orden cambia cuando alguien añade una.
CREATE OR REPLACE FUNCTION private.lr_pros_campo(p_titulo text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT CASE private.lr_pros_titulo(p_titulo)
  WHEN 'empresa' THEN 'empresa' WHEN 'cuenta' THEN 'empresa' WHEN 'marca' THEN 'empresa'
  WHEN 'dominio clave' THEN 'web' WHEN 'dominio' THEN 'web' WHEN 'web' THEN 'web' WHEN 'sitio' THEN 'web'
  WHEN 'nombre publico' THEN 'nombre' WHEN 'nombre' THEN 'nombre' WHEN 'contacto' THEN 'nombre'
  WHEN 'responsable' THEN 'nombre' WHEN 'persona' THEN 'nombre'
  WHEN 'cargo publicado' THEN 'cargo' WHEN 'cargo' THEN 'cargo' WHEN 'puesto' THEN 'cargo'
  -- «Perfil LinkedIn» es un =HYPERLINK: su texto es «Abrir perfil» y el TSV no trae el enlace. La
  -- columna «URL del perfil» de la hoja lo extrae con una fórmula, así que manda sobre aquella.
  WHEN 'url del perfil' THEN 'linkedin' WHEN 'perfil linkedin' THEN 'linkedin'
  WHEN 'perfil' THEN 'linkedin' WHEN 'linkedin' THEN 'linkedin'
  WHEN 'rubro' THEN 'rubro' WHEN 'segmento' THEN 'rubro' WHEN 'industria' THEN 'rubro'
  WHEN 'pregunta comercial' THEN 'pregunta' WHEN 'pregunta' THEN 'pregunta'
  WHEN 'consulta' THEN 'pregunta' WHEN 'nota' THEN 'pregunta'
  -- De dónde salió el contacto: la hoja lo dice por fila, no por pestaña.
  WHEN 'origen' THEN 'origen' WHEN 'fuente' THEN 'origen'
  -- «Fuente del cargo» no es esto: es el enlace a la página donde se leyó el cargo, y por eso no
  -- está arriba. Se compara el título entero, así que no se confunden.
  WHEN 'correo' THEN 'correo' WHEN 'email' THEN 'correo' WHEN 'e-mail' THEN 'correo'
  WHEN 'correo electronico' THEN 'correo' WHEN 'mail' THEN 'correo'
  WHEN 'telefono' THEN 'telefono' WHEN 'celular' THEN 'telefono' WHEN 'movil' THEN 'telefono'
  WHEN 'whatsapp' THEN 'telefono' WHEN 'numero' THEN 'telefono'
  ELSE NULL END;
$fn$;

-- ── Del origen de la hoja al canal de la tabla ─────────────────────────────
-- Los cuatro canales de lr_acrm_capturas se escriben de otra manera en la hoja, que es un documento
-- para leer: «Directo», «Ads Library». Una fila sin columna Origen, o con algo que no se reconoce,
-- es de Ads Library: es lo que hacía el barrido antes de esta migración y lo que sigue siendo verdad
-- para las 265 filas de siempre y para las diez que alguien pega a mano en el panel.
CREATE OR REPLACE FUNCTION private.lr_pros_canal(p_origen text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT CASE private.lr_pros_titulo(p_origen)
  WHEN 'directo' THEN 'directo'
  WHEN 'linkedin' THEN 'linkedin'
  WHEN 'whatsapp' THEN 'meta_whatsapp' WHEN 'meta' THEN 'meta_whatsapp'
  WHEN 'meta ads' THEN 'meta_whatsapp' WHEN 'meta ads / whatsapp' THEN 'meta_whatsapp'
  ELSE 'ads_library' END;
$fn$;

-- ── El alta de un prospecto, sin sesión ────────────────────────────────────
CREATE OR REPLACE FUNCTION private.lr_acrm_prospecto_guardar(p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_perfil text; v_web text; v_dominio text; v_clave text; v_nombre text; v_empresa text;
 v_canal text; v_tel text; v_tel_texto text; v_correo text; v_rotulo text;
 v_existe boolean; v_previo text;
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
  -- Las tildes se van antes de armar la clave: «Hernández» y «Hernandez» no son dos prospectos.
  IF v_dominio='' THEN v_dominio:=btrim(regexp_replace(private.lr_pros_titulo(v_empresa),'[^a-z0-9]+','-','g'),'-'); END IF;
  -- Un contacto de una lista puede no traer ni empresa ni dominio. Lo que lo identifica es entonces
  -- su número, o su correo si no hay número: son los 213 del CRM de Tierra Films que llegaron con el
  -- teléfono metido en la casilla de la empresa y nada más.
  IF v_dominio='' AND v_tel<>'' THEN v_dominio:='tel-'||v_tel; END IF;
  IF v_dominio='' AND v_correo<>'' THEN
   v_dominio:='correo-'||btrim(regexp_replace(v_correo,'[^a-z0-9]+','-','g'),'-');
  END IF;
  IF v_dominio='' THEN
   RAISE EXCEPTION 'Un prospecto necesita al menos su dominio, el nombre de la empresa, un teléfono o un correo';
  END IF;
  v_clave:='ads:'||left(v_dominio,400);
  IF v_nombre<>'' THEN
   SELECT x.nombre INTO v_previo FROM public.lr_acrm_capturas x
    JOIN public.lr_acrm_embudo e ON e.captura=x.clave
    WHERE x.clave=v_clave AND x.canal=v_canal AND e.etapa='nuevo'
      AND x.nombre IN (v_empresa,v_dominio,v_tel_texto,v_correo);
   IF v_previo IS NULL THEN
    v_clave:=left(v_clave||'-'||btrim(regexp_replace(private.lr_pros_titulo(v_nombre),'[^a-z0-9]+','-','g'),'-'),480);
   END IF;
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
  web=CASE WHEN lr_acrm_capturas.web='' THEN excluded.web ELSE lr_acrm_capturas.web END,
  telefono=CASE WHEN lr_acrm_capturas.telefono='' THEN excluded.telefono ELSE lr_acrm_capturas.telefono END,
  correo=CASE WHEN lr_acrm_capturas.correo='' THEN excluded.correo ELSE lr_acrm_capturas.correo END;
 RETURN jsonb_build_object('ok',true,'clave',v_clave,'nuevo',NOT v_existe,'canal',v_canal);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_prospecto_guardar(jsonb) FROM PUBLIC,anon,authenticated;

-- ── La hoja completa ───────────────────────────────────────────────────────
-- Igual que en 20261123090000, con tres campos más por fila y una regla de descarte más ancha: una
-- fila que solo trae un número o un correo es un contacto, y antes se saltaba por no tener empresa.
CREATE OR REPLACE FUNCTION private.lr_acrm_prospecto_hoja(p_texto text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
 v_linea text; v_celdas text[]; v_campo text; v_titulo text;
 v_mapa jsonb:='{}'::jsonb; v_cabecera boolean:=false;
 v_datos jsonb; v_salida jsonb; v_cargo text; v_pregunta text; v_consulta text; v_url text;
 v_filas int:=0; v_nuevos int:=0; v_repetidos int:=0; v_errores jsonb:='[]'::jsonb;
 v_canales jsonb:='{}'::jsonb; v_canal text;
 i int;
BEGIN
 FOREACH v_linea IN ARRAY string_to_array(replace(coalesce(p_texto,''),E'\r',''),E'\n') LOOP
  IF btrim(v_linea)='' THEN CONTINUE; END IF;
  v_celdas:=string_to_array(v_linea,E'\t');
  -- La fila de títulos: la primera con alguna columna reconocible. Una segunda fila de títulos
  -- (pasa al pegar dos trozos de la hoja) se salta más abajo.
  IF NOT v_cabecera THEN
   FOR i IN 1..array_length(v_celdas,1) LOOP
    v_titulo:=private.lr_pros_titulo(v_celdas[i]);
    v_campo:=private.lr_pros_campo(v_celdas[i]);
    IF v_campo IS NULL THEN CONTINUE; END IF;
    -- La primera columna de cada campo manda, salvo «URL del perfil», que es la buena para el
    -- perfil aunque «Perfil LinkedIn» venga antes.
    IF NOT v_mapa ? v_campo OR v_titulo='url del perfil' THEN
     v_mapa:=v_mapa||jsonb_build_object(v_campo,i);
    END IF;
   END LOOP;
   IF v_mapa ? 'empresa' OR v_mapa ? 'web' OR v_mapa ? 'nombre' THEN
    v_cabecera:=true;
   ELSE
    v_mapa:='{}'::jsonb;
   END IF;
   CONTINUE;
  END IF;
  -- Una fila cuyos valores son los propios títulos no es un prospecto.
  IF private.lr_pros_campo(v_celdas[(v_mapa->>'empresa')::int]) IS NOT NULL THEN CONTINUE; END IF;
  v_datos:='{}'::jsonb;
  FOR v_campo IN SELECT jsonb_object_keys(v_mapa) LOOP
   i:=(v_mapa->>v_campo)::int;
   v_datos:=v_datos||jsonb_build_object(v_campo,btrim(coalesce(v_celdas[i],'')));
  END LOOP;
  -- El cargo publicado y la pregunta comercial son lo que se sabe del prospecto antes de escribirle:
  -- van juntos en la consulta, que es lo que la tabla enseña bajo su nombre.
  v_cargo:=coalesce(v_datos->>'cargo','');
  v_pregunta:=coalesce(v_datos->>'pregunta','');
  v_consulta:=btrim(concat_ws(' · ',nullif(v_cargo,''),nullif(v_pregunta,'')));
  v_datos:=v_datos||jsonb_build_object('consulta',v_consulta);
  -- Lo que la hoja trae en «Perfil LinkedIn» cuando no hay columna de URL es el texto del enlace
  -- («Abrir perfil»): eso no es un perfil y el prospecto entra sin él.
  IF coalesce(v_datos->>'linkedin','') !~* '^https?://([a-z]{2,3}\.)?(www\.)?linkedin\.com/in/' THEN
   v_datos:=v_datos||jsonb_build_object('linkedin','');
  ELSE
   -- Normalizada igual que en el navegador (perfilLinkedin): sin país, sin parámetros, sin ancla y
   -- sin lo que venga después del identificador. Lo último importa: la hoja trae perfiles copiados
   -- en otro idioma («…/in/renzo-ibanez/en»), que son la misma persona y, sin recortar, ni entran.
   v_url:=lower(split_part(split_part(btrim(v_datos->>'linkedin'),'?',1),'#',1));
   v_url:=regexp_replace(v_url,'^https?://([a-z]{2,3}\.|www\.)?linkedin\.com/','https://www.linkedin.com/');
   v_url:=regexp_replace(v_url,'^(https://www\.linkedin\.com/in/[^/]+).*$','\1');
   -- El id interno de LinkedIn (ACoAAA…) tampoco es un perfil: el prospecto entra sin él, igual que
   -- cuando la hoja solo trae el texto «Abrir perfil» (20261124180000).
   IF v_url ~ '^https://www\.linkedin\.com/in/acoaa[a-z0-9_-]{20,}$' THEN v_url:=''; END IF;
   v_datos:=v_datos||jsonb_build_object('linkedin',v_url);
  END IF;
  -- Una fila sin nada con lo que llamar a nadie no es un contacto. El teléfono y el correo cuentan:
  -- las 213 filas que llegaron del CRM de Tierra Films con solo un número se saltaban acá.
  IF coalesce(v_datos->>'empresa','')='' AND coalesce(v_datos->>'web','')=''
     AND coalesce(v_datos->>'nombre','')='' AND coalesce(v_datos->>'telefono','')=''
     AND coalesce(v_datos->>'correo','')='' THEN CONTINUE; END IF;
  v_filas:=v_filas+1;
  BEGIN
   v_salida:=private.lr_acrm_prospecto_guardar(v_datos);
   IF (v_salida->>'nuevo')::boolean THEN v_nuevos:=v_nuevos+1; ELSE v_repetidos:=v_repetidos+1; END IF;
   -- Cuántas filas entraron por cada origen: es lo que dice si la hoja trae lo que se cree que trae.
   v_canal:=v_salida->>'canal';
   v_canales:=v_canales||jsonb_build_object(v_canal,coalesce((v_canales->>v_canal)::int,0)+1);
  EXCEPTION WHEN others THEN
   IF jsonb_array_length(v_errores)<20 THEN
    v_errores:=v_errores||jsonb_build_object(
     'empresa',coalesce(v_datos->>'empresa',''),'nombre',coalesce(v_datos->>'nombre',''),'motivo',SQLERRM);
   END IF;
  END;
 END LOOP;
 IF NOT v_cabecera THEN
  RAISE EXCEPTION 'La hoja no trae su fila de títulos (Empresa, Dominio clave, Nombre público…)';
 END IF;
 RETURN jsonb_build_object('ok',true,'filas',v_filas,'nuevos',v_nuevos,'repetidos',v_repetidos,
  'errores',v_errores,'canales',v_canales,
  'columnas',(SELECT coalesce(jsonb_agg(k ORDER BY k),'[]'::jsonb) FROM jsonb_object_keys(v_mapa) k));
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_prospecto_hoja(text) FROM PUBLIC,anon,authenticated;

-- ── El correo, también a mano ──────────────────────────────────────────────
-- La misma función que guarda rubro, empresa, web y teléfono desde la ficha (20261114110000), con el
-- correo añadido y con la misma regla: una pantalla vieja en caché que no mande la clave no borra lo
-- que hay, y mandarla vacía sí, que es como se corrige una dirección equivocada.
CREATE OR REPLACE FUNCTION private.lr_acrm_datos(p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_uid uuid:=auth.uid(); v_web text; v_tel text; v_correo text;
BEGIN
 IF v_uid IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN
  RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501';
 END IF;
 -- La web se guarda como URL completa: «limaretail.com» escrito a mano, pintado como enlace tal
 -- cual, abriría una ruta de la propia suite en vez del sitio del prospecto.
 v_web:=btrim(coalesce(p_datos->>'web',''));
 IF v_web<>'' AND v_web !~* '^https?://' THEN v_web:='https://'||v_web; END IF;
 -- El teléfono se normaliza aquí: fuera los espacios, guiones, paréntesis y el «+», y el 51 delante
 -- si es un celular peruano de nueve dígitos. Es lo mismo que hace waDe() en el navegador, repetido
 -- en la base porque lo que valida una pantalla no vale: a la función se la puede llamar sin ella.
 -- Vacío es borrar el número, que es como se corrige uno equivocado. Algo escrito que no deja un
 -- número usable no se convierte en borrarlo: se rechaza, y el que había se queda donde está.
 v_tel:=btrim(coalesce(p_datos->>'telefono',''));
 IF v_tel<>'' THEN
  v_tel:=regexp_replace(v_tel,'[^0-9]','','g');
  IF v_tel ~ '^9[0-9]{8}$' THEN v_tel:='51'||v_tel; END IF;
  IF v_tel !~ '^[0-9]{7,20}$' THEN
   RAISE EXCEPTION 'Teléfono inválido: hacen falta entre 7 y 20 dígitos';
  END IF;
 END IF;
 -- El correo, igual: escrito a mano se rechaza lo que no es una dirección, en vez de guardar algo
 -- que luego no sirve para escribirle. El barrido de la hoja no pasa por acá y hace lo contrario
 -- —descartar la dirección y quedarse con el contacto—, porque ahí no hay nadie a quien avisar.
 v_correo:=lower(btrim(coalesce(p_datos->>'correo','')));
 IF v_correo<>'' AND (length(v_correo)>200
    OR v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN
  RAISE EXCEPTION 'Correo inválido: hace falta una dirección como nombre@empresa.com';
 END IF;
 UPDATE public.lr_acrm_capturas SET
  rubro=left(btrim(coalesce(p_datos->>'rubro','')),120),
  empresa=left(btrim(coalesce(p_datos->>'empresa','')),200),
  web=left(v_web,300),
  telefono=CASE WHEN jsonb_exists(p_datos,'telefono') THEN v_tel ELSE telefono END,
  correo=CASE WHEN jsonb_exists(p_datos,'correo') THEN v_correo ELSE correo END
 WHERE clave=p_datos->>'captura';
 IF NOT FOUND THEN RAISE EXCEPTION 'Ese prospecto no existe'; END IF;
 RETURN jsonb_build_object('ok',true,'telefono',v_tel,'correo',v_correo);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_datos(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_datos(jsonb) TO authenticated;

COMMIT;
