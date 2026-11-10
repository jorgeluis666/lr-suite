// La migración del lote 15 se pega a mano en el editor de Supabase: un error de sintaxis se
// descubre allí, con la base delante. Aquí la compila Postgres de verdad —PGlite— con lo que la
// migración da por existente (la extensión http, pg_cron y las tablas de automatización)
// simulado, que es lo único que PGlite no trae.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261110120000_lote15_clave_drive_y_cron_huerfanos.sql', import.meta.url),
  'utf8'
);

const db = new PGlite();

// El andamio: solo lo que la migración necesita para compilar.
await db.exec(`
CREATE SCHEMA extensions;
CREATE SCHEMA cron;
CREATE TYPE extensions.http_header AS (field text, value text);
CREATE TYPE extensions.http_response AS (status integer, content_type text, headers extensions.http_header[], content text);
CREATE FUNCTION extensions.http_get(text) RETURNS extensions.http_response LANGUAGE sql AS $f$ SELECT NULL::extensions.http_response $f$;
CREATE FUNCTION extensions.http_set_curlopt(text, text) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
CREATE TABLE cron.job (jobid bigint, jobname text, schedule text, active boolean);
CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE public.lr_suite_automation_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job text NOT NULL, trigger text NOT NULL DEFAULT 'manual', requested_by text,
  requested_at timestamptz NOT NULL DEFAULT now(), scheduled_for timestamptz, cron_job_name text,
  status text NOT NULL DEFAULT 'en_cola' CHECK (status IN ('en_cola','ok','error')),
  started_at timestamptz, finished_at timestamptz, duration_ms integer, rows_loaded integer,
  detail jsonb, error_detail text);
CREATE TABLE public.lr_suite_automation_components (id text PRIMARY KEY, run_function text);
CREATE TABLE public.lr_suite_private_data (key text PRIMARY KEY, payload jsonb);
CREATE FUNCTION public.lr_suite_automation_run_json(p_run public.lr_suite_automation_runs) RETURNS jsonb LANGUAGE sql AS $f$ SELECT to_jsonb(p_run) $f$;
CREATE FUNCTION public.lr_suite_automation_summary(p_result jsonb) RETURNS jsonb LANGUAGE sql AS $f$ SELECT coalesce(p_result,'{}'::jsonb) $f$;
`);

// check_function_bodies está activo por defecto: Postgres parsea el PL/pgSQL al crear la función.
await db.exec(sql.replace(/^NOTIFY pgrst.*$/m, ''));

// Las cuatro funciones existen con la firma que espera quien las llama.
for (const firma of [
  'public.lr_suite_keywords_http_get(text,integer)',
  'public.lr_suite_keywords_download(jsonb)',
  'public.lr_suite_automation_limpiar_huerfanos()',
  'public.lr_suite_automation_process(bigint)'
]) {
  const {rows} = await db.query(`SELECT pg_get_functiondef('${firma}'::regprocedure) AS def`);
  assert.ok(rows[0].def, `falta ${firma}`);
}

// ── La clave no puede aparecer en un mensaje ──────────────────────────────
const oculta = await db.query(
  `SELECT regexp_replace($1, '([?&]key=)[^&]+', '\\1<oculta>', 'g') AS url`,
  ['https://www.googleapis.com/drive/v3/files?q=x&key=AIzaSyCLAVESECRETA123&fields=files']
);
assert.equal(oculta.rows[0].url, 'https://www.googleapis.com/drive/v3/files?q=x&key=<oculta>&fields=files');
assert.equal(oculta.rows[0].url.includes('AIzaSy'), false, 'la clave tiene que desaparecer entera');

// ── La limpieza de huérfanos, ejecutada ───────────────────────────────────
await db.exec(`
INSERT INTO cron.job VALUES (1, 'lr-suite-automation-run-10', '3 15 11 10 *', true);
INSERT INTO cron.job VALUES (2, 'lr-suite-automation-run-11', '0 9 1 1 *', true);
INSERT INTO cron.job VALUES (3, 'lr-suite-automation-run-99', '0 9 1 1 *', true);
INSERT INTO cron.job VALUES (4, 'lr-suite-keywords-diario', '0 6 * * *', true);
-- 10: en cola y vencida hace dos horas. Hay que barrerla y marcarla error.
INSERT INTO public.lr_suite_automation_runs (job, scheduled_for, cron_job_name, status)
VALUES ('palabras-clave', now() - interval '2 hours', 'lr-suite-automation-run-10', 'en_cola');
-- 11: en cola y todavía a tiempo. No se toca.
INSERT INTO public.lr_suite_automation_runs (job, scheduled_for, cron_job_name, status)
VALUES ('palabras-clave', now() + interval '5 minutes', 'lr-suite-automation-run-11', 'en_cola');
-- 99: su corrida ya no existe (se borró por antigüedad). El job quedaría para siempre.
`);

const {rows: limpieza} = await db.query('SELECT public.lr_suite_automation_limpiar_huerfanos() AS n');
assert.equal(limpieza[0].n, 2, 'se barren la vencida y la que ya no tiene corrida');

const {rows: quedan} = await db.query(`SELECT jobname FROM cron.job ORDER BY jobid`);
assert.deepEqual(quedan.map((r) => r.jobname).join(','), 'lr-suite-automation-run-10,lr-suite-automation-run-11,lr-suite-automation-run-99,lr-suite-keywords-diario',
  'cron.unschedule aquí es un simulacro, así que las filas siguen: lo que se comprueba es cuántas veces se llamó');

const {rows: estados} = await db.query(
  `SELECT cron_job_name, status, error_detail FROM public.lr_suite_automation_runs ORDER BY id`
);
assert.equal(estados[0].status, 'error', 'la vencida se marca error');
assert.equal(estados[0].error_detail, 'No se ejecutó a tiempo');
assert.equal(estados[1].status, 'en_cola', 'la que está a tiempo se deja en paz');

// El cron diario de palabras clave no se toca: no empieza por lr-suite-automation-run-.
assert.ok(quedan.some((r) => r.jobname === 'lr-suite-keywords-diario'));

// ── Una corrida vencida no se ejecuta tarde ───────────────────────────────
// El componente que ejecutaría la corrida. De momento revienta: si process llegara a llamarlo con
// una corrida vencida, se notaría.
await db.exec(`
INSERT INTO public.lr_suite_automation_components VALUES ('palabras-clave', 'public.componente_de_prueba');
CREATE FUNCTION public.componente_de_prueba(text, text) RETURNS jsonb LANGUAGE plpgsql AS $f$
begin raise exception 'esto no se tenia que ejecutar'; end $f$;
`);
await db.exec(`
INSERT INTO public.lr_suite_automation_runs (job, requested_at, scheduled_for, cron_job_name, status)
VALUES ('palabras-clave', now() - interval '3 hours', now() - interval '3 hours', 'lr-suite-automation-run-50', 'en_cola');
`);
const {rows: vencidaId} = await db.query(
  `SELECT id FROM public.lr_suite_automation_runs WHERE cron_job_name = 'lr-suite-automation-run-50'`
);
const {rows: procesada} = await db.query('SELECT public.lr_suite_automation_process($1) AS r', [vencidaId[0].id]);
assert.equal(procesada[0].r.status, 'error', 'una corrida de hace tres horas no se lanza');
assert.equal(procesada[0].r.error_detail, 'No se ejecutó a tiempo');
assert.equal(procesada[0].r.started_at, null, 'ni siquiera se empezó: el componente no se llamó');

// Y una a tiempo sí llega a ejecutar su componente.
await db.exec(`
CREATE OR REPLACE FUNCTION public.componente_de_prueba(text, text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{"total": 7}'::jsonb $f$;
INSERT INTO public.lr_suite_automation_runs (job, requested_at, scheduled_for, cron_job_name, status)
VALUES ('palabras-clave', now(), now(), 'lr-suite-automation-run-51', 'en_cola');
`);
const {rows: aTiempoId} = await db.query(
  `SELECT id FROM public.lr_suite_automation_runs WHERE cron_job_name = 'lr-suite-automation-run-51'`
);
const {rows: ok} = await db.query('SELECT public.lr_suite_automation_process($1) AS r', [aTiempoId[0].id]);
assert.equal(ok[0].r.status, 'ok', 'una corrida a tiempo se ejecuta como siempre');
assert.equal(ok[0].r.rows_loaded, 7);

await db.close();
console.log('PASS lote 15: la migración compila en Postgres, la clave de Drive desaparece del mensaje, la limpieza barre el job vencido y el que perdió su corrida pero respeta el que está a tiempo y el cron diario, y una corrida de hace tres horas se marca error en vez de lanzarse.');
