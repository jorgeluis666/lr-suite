-- El demo público del agente: la conversación de verdad que ofrece la landing.
--
-- La página de agentes (limaretail.com/agentes-ia-whatsapp) deja que cualquiera hable con el
-- agente antes de dejar un dato. Eso es un endpoint de Claude abierto a internet, así que lo que
-- aquí se guarda es también lo que permite ponerle freno: una fila por sesión con sus turnos y el
-- hash de su IP, y una fila por mensaje. Sin eso no hay forma de contar ni de cortar.
--
-- Nada de esto reemplaza al ACRM: cuando el visitante deja sus datos, el lead entra al ACRM como
-- cualquier otro, con su conversación en el hilo (lr_demo_lead, más abajo).
--
-- Se aplica desde el editor SQL, como el resto.
BEGIN;

-- ── La sesión del demo ─────────────────────────────────────────────────────
-- Una por visitante que escribe. Dura lo que dura la pestaña; no hay cuentas ni contraseñas.
-- De la IP solo se guarda un hash: alcanza para contar sesiones por hora y no es un dato personal
-- que haya que custodiar.
CREATE TABLE IF NOT EXISTS public.lr_demo_sesiones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 creada_en timestamptz NOT NULL DEFAULT now(),
 vista_en timestamptz NOT NULL DEFAULT now(),
 ip_hash text NOT NULL DEFAULT '',
 origen text NOT NULL DEFAULT '',
 turnos integer NOT NULL DEFAULT 0,
 -- Lo que el visitante deja cuando el agente ya le contestó una vez (el peaje de la landing).
 nombre text NOT NULL DEFAULT '',
 telefono text NOT NULL DEFAULT '',
 email text NOT NULL DEFAULT '',
 empresa text NOT NULL DEFAULT '',
 -- Su lead en el ACRM, si llegó a dejar los datos.
 captura text REFERENCES public.lr_acrm_capturas(clave) ON DELETE SET NULL,
 CHECK (length(ip_hash) <= 64 AND length(origen) <= 300 AND turnos BETWEEN 0 AND 200),
 CHECK (length(nombre) <= 120 AND telefono ~ '^([0-9]{7,20})?$' AND length(email) <= 200 AND length(empresa) <= 200)
);
CREATE INDEX IF NOT EXISTS lr_demo_sesiones_ip ON public.lr_demo_sesiones(ip_hash, creada_en DESC);
CREATE INDEX IF NOT EXISTS lr_demo_sesiones_fecha ON public.lr_demo_sesiones(creada_en DESC);

CREATE TABLE IF NOT EXISTS public.lr_demo_mensajes (
 id bigserial PRIMARY KEY,
 sesion uuid NOT NULL REFERENCES public.lr_demo_sesiones(id) ON DELETE CASCADE,
 rol text NOT NULL CHECK (rol IN ('cliente','agente')),
 texto text NOT NULL CHECK (length(texto) BETWEEN 1 AND 4000),
 creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_demo_mensajes_hilo ON public.lr_demo_mensajes(sesion, creado_en);
CREATE INDEX IF NOT EXISTS lr_demo_mensajes_fecha ON public.lr_demo_mensajes(creado_en DESC) WHERE rol = 'agente';

-- Escribe la función del demo, que entra con la llave de servicio y se salta RLS. Las dos personas
-- de la agencia pueden leer lo que la gente preguntó, que es la mejor fuente de copy que vamos a
-- tener; nadie más, y nadie escribe desde el navegador.
ALTER TABLE public.lr_demo_sesiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_demo_mensajes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lr_demo_sesiones_leer ON public.lr_demo_sesiones;
CREATE POLICY lr_demo_sesiones_leer ON public.lr_demo_sesiones FOR SELECT TO authenticated
 USING (public.lr_pros_usuario_habilitado());
DROP POLICY IF EXISTS lr_demo_mensajes_leer ON public.lr_demo_mensajes;
CREATE POLICY lr_demo_mensajes_leer ON public.lr_demo_mensajes FOR SELECT TO authenticated
 USING (public.lr_pros_usuario_habilitado());
GRANT SELECT ON public.lr_demo_sesiones, public.lr_demo_mensajes TO authenticated;

-- ── El correo del lead, que tampoco tenía columna ──────────────────────────
-- Igual que pasaba con el teléfono antes de 20261114110000: el correo solo existía dentro de la
-- cotización, así que un lead que lo deja en el demo no tenía dónde aterrizar. Va al lado del
-- teléfono, en la captura, y se guarda por la misma función.
ALTER TABLE public.lr_acrm_capturas ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
ALTER TABLE public.lr_acrm_capturas DROP CONSTRAINT IF EXISTS lr_acrm_capturas_email_largo;
ALTER TABLE public.lr_acrm_capturas ADD CONSTRAINT lr_acrm_capturas_email_largo CHECK (length(email) <= 200);

CREATE OR REPLACE FUNCTION private.lr_acrm_datos(p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_uid uuid:=auth.uid(); v_web text; v_tel text; v_mail text;
BEGIN
 IF v_uid IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN
  RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501';
 END IF;
 v_web:=btrim(coalesce(p_datos->>'web',''));
 IF v_web<>'' AND v_web !~* '^https?://' THEN v_web:='https://'||v_web; END IF;
 -- El teléfono se normaliza aquí: fuera los espacios, guiones, paréntesis y el «+», y el 51 delante
 -- si es un celular peruano de nueve dígitos. Vacío borra; algo que no deja un número usable se
 -- rechaza y el que había se queda.
 v_tel:=btrim(coalesce(p_datos->>'telefono',''));
 IF v_tel<>'' THEN
  v_tel:=regexp_replace(v_tel,'[^0-9]','','g');
  IF v_tel ~ '^9[0-9]{8}$' THEN v_tel:='51'||v_tel; END IF;
  IF v_tel !~ '^[0-9]{7,20}$' THEN
   RAISE EXCEPTION 'Teléfono inválido: hacen falta entre 7 y 20 dígitos';
  END IF;
 END IF;
 -- El correo con la misma vara: vacío lo borra, y lo que no parece un correo se rechaza en vez de
 -- guardarse mal y descubrirlo el día que alguien le escriba.
 v_mail:=lower(btrim(coalesce(p_datos->>'email','')));
 IF v_mail<>'' AND v_mail !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' THEN
  RAISE EXCEPTION 'Correo inválido';
 END IF;
 UPDATE public.lr_acrm_capturas SET
  rubro=left(btrim(coalesce(p_datos->>'rubro','')),120),
  empresa=left(btrim(coalesce(p_datos->>'empresa','')),200),
  web=left(v_web,300),
  -- Una pantalla vieja en caché manda los campos de antes y ninguna de estas dos claves: sin la
  -- clave, lo que ya estaba se queda donde está. Mandarla vacía sí lo borra, que es como se corrige.
  telefono=CASE WHEN jsonb_exists(p_datos,'telefono') THEN v_tel ELSE telefono END,
  email=CASE WHEN jsonb_exists(p_datos,'email') THEN left(v_mail,200) ELSE email END
 WHERE clave=p_datos->>'captura';
 IF NOT FOUND THEN RAISE EXCEPTION 'Ese prospecto no existe'; END IF;
 RETURN jsonb_build_object('ok',true,'telefono',v_tel,'email',v_mail);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_datos(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_datos(jsonb) TO authenticated;

-- ── Del demo al ACRM ───────────────────────────────────────────────────────
-- Cuando el visitante deja sus datos, deja de ser una sesión anónima y pasa a ser un lead como
-- cualquier otro: su captura, su fila en el embudo (la pone el trigger) y la conversación entera
-- en el hilo, para que quien lo atienda lea lo que ya habló con el agente.
--
-- Canal 'directo', que es el que existe para «llegó por su cuenta». La clave web:<sesión> distingue
-- a los del demo sin inventar un canal nuevo, que obligaría a tocar el marcador y los conteos.
--
-- Solo la llave de servicio: esto lo llama la función del demo, nunca un navegador.
CREATE OR REPLACE FUNCTION public.lr_demo_lead(p_sesion uuid, p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
 v_clave text; v_tel text; v_mail text; v_nombre text; v_empresa text; v_consulta text; v_msg record;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.lr_demo_sesiones WHERE id=p_sesion) THEN
  RAISE EXCEPTION 'Esa sesión del demo no existe';
 END IF;
 v_nombre:=left(btrim(coalesce(p_datos->>'nombre','')),120);
 IF v_nombre='' THEN v_nombre:='Visitante del demo'; END IF;
 v_empresa:=left(btrim(coalesce(p_datos->>'empresa','')),200);
 v_tel:=regexp_replace(coalesce(p_datos->>'telefono',''),'[^0-9]','','g');
 IF v_tel ~ '^9[0-9]{8}$' THEN v_tel:='51'||v_tel; END IF;
 IF v_tel !~ '^[0-9]{7,20}$' THEN v_tel:=''; END IF;
 v_mail:=lower(btrim(coalesce(p_datos->>'email','')));
 IF v_mail !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' THEN v_mail:=''; END IF;
 -- Lo primero que preguntó es su consulta: es lo que la tabla del ACRM enseña como motivo.
 SELECT left(texto,2000) INTO v_consulta FROM public.lr_demo_mensajes
  WHERE sesion=p_sesion AND rol='cliente' ORDER BY creado_en LIMIT 1;

 v_clave:='web:'||p_sesion::text;
 INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en,consulta,empresa,telefono,email)
 VALUES (v_clave,'directo',v_nombre,now(),coalesce(v_consulta,''),v_empresa,v_tel,v_mail)
 ON CONFLICT (clave) DO UPDATE SET
  nombre=EXCLUDED.nombre, empresa=EXCLUDED.empresa, telefono=EXCLUDED.telefono, email=EXCLUDED.email;

 -- La conversación en el hilo, en orden. Lo del agente va sin autor y con origen 'agente', igual
 -- que lo que escribe el bot de WhatsApp: mueve el embudo pero no cuenta para la racha de nadie.
 FOR v_msg IN SELECT rol, texto, creado_en FROM public.lr_demo_mensajes
   WHERE sesion=p_sesion ORDER BY creado_en LOOP
  INSERT INTO public.lr_acrm_mensajes(captura,direccion,texto,enviado_en,autor,origen)
  VALUES (v_clave,
   CASE WHEN v_msg.rol='cliente' THEN 'recibido' ELSE 'enviado' END,
   v_msg.texto, v_msg.creado_en, NULL,
   CASE WHEN v_msg.rol='cliente' THEN 'webhook' ELSE 'agente' END);
 END LOOP;

 UPDATE public.lr_demo_sesiones SET
  nombre=v_nombre, telefono=v_tel, email=v_mail, empresa=v_empresa, captura=v_clave, vista_en=now()
 WHERE id=p_sesion;

 RETURN jsonb_build_object('ok',true,'captura',v_clave);
END $fn$;
REVOKE ALL ON FUNCTION public.lr_demo_lead(uuid,jsonb) FROM PUBLIC,anon,authenticated;

-- Limpieza: las conversaciones del demo no son un archivo histórico. Se borran a los 90 días; el
-- lead que dejó sus datos ya vive en el ACRM y no depende de esto.
CREATE OR REPLACE FUNCTION public.lr_demo_limpiar(p_dias integer DEFAULT 90) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 WITH borradas AS (
  DELETE FROM public.lr_demo_sesiones
  WHERE creada_en < now() - make_interval(days => greatest(coalesce(p_dias,90), 7))
    AND captura IS NULL
  RETURNING 1
 ) SELECT count(*)::integer FROM borradas;
$fn$;
REVOKE ALL ON FUNCTION public.lr_demo_limpiar(integer) FROM PUBLIC,anon,authenticated;

COMMIT;
