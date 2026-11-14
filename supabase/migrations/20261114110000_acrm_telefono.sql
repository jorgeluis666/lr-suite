-- El teléfono de cualquier lead, en la tabla maestra del ACRM.
--
-- Hasta ahora el número de un lead salía de dos sitios y de ninguno más: de la clave de su captura
-- (wa:<número del negocio>:<cliente>), que solo tienen los que escribieron por WhatsApp, y del campo
-- telefono de su cotización, que solo tienen los que ya llegaron a cotizar. Un lead de LinkedIn al
-- que alguien le saca el número por chat no tenía dónde dejarlo salvo inventándole una cotización, y
-- su ficha decía «Este lead no tiene teléfono» para siempre. Son más de cuatro mil leads así.
--
-- Con la columna, y sin tocar nada más, la ficha enciende sola: claveWhatsapp() arma wa:0:<número>
-- para cualquier lead con teléfono, así que en cuanto el número está se leen su conversación y el
-- estado del bot con el código que ya existe.
--
-- Va en lr_acrm_capturas, al lado de rubro, empresa y web (20261111100000): es un dato de
-- calificación, anterior a cotizar, y la captura es la única fila que tiene todo lead de los tres
-- canales. Se guarda por lr_acrm_datos, la misma función que aquellos tres, que aquí se reemplaza
-- entera para añadirle el cuarto campo; por eso esta migración va después de aquella y no sola.
--
-- No toca lr_acrm_operar ni la cotización: el teléfono de una cotización sigue siendo el contacto de
-- esa cotización, y manda sobre este cuando la hay. Este es el del lead.
BEGIN;

ALTER TABLE public.lr_acrm_capturas ADD COLUMN IF NOT EXISTS telefono text NOT NULL DEFAULT '';

-- Solo dígitos, como el número que vive dentro de la clave de un lead de WhatsApp: así el mismo
-- código lee los dos, y «+51 987 654 321» y «987654321» no acaban siendo dos números distintos.
ALTER TABLE public.lr_acrm_capturas DROP CONSTRAINT IF EXISTS lr_acrm_capturas_telefono_formato;
ALTER TABLE public.lr_acrm_capturas ADD CONSTRAINT lr_acrm_capturas_telefono_formato
 CHECK (telefono ~ '^([0-9]{7,20})?$');

-- Rubro, empresa, web y ahora el teléfono de un lead. Escribe cualquier cuenta habilitada, como el
-- resto del ACRM; la captura tiene que existir ya (un lead se estrena por su canal o por su
-- cotización, nunca por acá).
CREATE OR REPLACE FUNCTION private.lr_acrm_datos(p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_uid uuid:=auth.uid(); v_web text; v_tel text;
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
 UPDATE public.lr_acrm_capturas SET
  rubro=left(btrim(coalesce(p_datos->>'rubro','')),120),
  empresa=left(btrim(coalesce(p_datos->>'empresa','')),200),
  web=left(v_web,300),
  -- Una pantalla vieja en caché sigue mandando los tres de antes y ningún teléfono: sin la clave, el
  -- número que ya estaba se queda donde está. Mandarla vacía sí lo borra, que es como se corrige.
  telefono=CASE WHEN jsonb_exists(p_datos,'telefono') THEN v_tel ELSE telefono END
 WHERE clave=p_datos->>'captura';
 IF NOT FOUND THEN RAISE EXCEPTION 'Ese prospecto no existe'; END IF;
 RETURN jsonb_build_object('ok',true,'telefono',v_tel);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_datos(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_datos(jsonb) TO authenticated;

COMMIT;
