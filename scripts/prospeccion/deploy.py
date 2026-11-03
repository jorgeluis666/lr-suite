#!/usr/bin/env python3
"""Deploy the verified static module only after its Supabase migration succeeds.
Requires SUPABASE_ACCESS_TOKEN and existing GitHub CLI/Git authentication.
No credentials are stored or logged. Run from a clean, committed checkout.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
REPO = 'jorgeluis666/lr-suite'
PROJECT = 'brfsipssqfsuoplxxcth'
SITE = 'https://jorgeluis666.github.io/lr-suite/'
SQL = ROOT / 'src/modules/prospeccion/BBDD/prospeccion-seguimiento-v1.sql'
ASSETS = ['index.html', 'src/modules/prospeccion/contactos-propios.js',
          'src/modules/prospeccion/investigacion-integrada.css']


def command(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()


def query(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{PROJECT}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'],
                 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.load(response)


def deploy(apply):
    if not os.environ.get('SUPABASE_ACCESS_TOKEN'):
        raise RuntimeError('Falta SUPABASE_ACCESS_TOKEN en la configuración segura del entorno.')
    if command('git', 'status', '--porcelain'):
        raise RuntimeError('Guarda los cambios en un commit antes de desplegar.')
    pages = json.loads(command('gh', 'api', f'repos/{REPO}/pages'))
    if pages.get('source') != {'branch': 'main', 'path': '/'} or pages.get('build_type') != 'legacy':
        raise RuntimeError('La publicación no usa Pages desde main/; revisar configuración antes de continuar.')
    command('git', 'fetch', 'origin', 'main')
    command('git', 'merge-base', '--is-ancestor', 'origin/main', 'HEAD')
    prerequisite = query("SELECT to_regclass('public.lr_pros_contactos_unificados') IS NOT NULL AS ready")
    if not prerequisite or not prerequisite[0]['ready']:
        raise RuntimeError('Falta la vista compartida de contactos; no se publicará el frontend.')
    print('Acceso y prerrequisitos comprobados.', flush=True)
    if not apply:
        print('Sin cambios. Usa --apply para aplicar SQL y publicar el commit actual.')
        return
    query(SQL.read_text())
    verification = query("""SELECT
      to_regclass('public.lr_pros_seguimiento') IS NOT NULL AS view_ready,
      to_regprocedure('public.lr_pros_guardar_seguimiento(text,jsonb,jsonb)') IS NOT NULL AS rpc_ready,
      NOT has_table_privilege('anon','public.lr_pros_mensajes','SELECT') AS anon_blocked,
      NOT has_table_privilege('authenticated','public.lr_pros_mensajes','INSERT') AS direct_write_blocked
    """)
    if not verification or not all(verification[0].values()):
        raise RuntimeError('La verificación de esquema/permisos falló. Frontend sin publicar.')
    print('Migración y permisos verificados. Publicando…', flush=True)
    command('git', 'push', 'origin', 'HEAD:main')
    wanted = {asset: hashlib.sha256((ROOT / asset).read_bytes()).hexdigest() for asset in ASSETS}
    # Each request uses the environment proxy and normal TLS verification.
    for attempt in range(24):
        ready = True
        for asset, digest in wanted.items():
            try:
                with urllib.request.urlopen(SITE + asset + '?verify=' + digest[:16], timeout=20) as response:
                    ready &= hashlib.sha256(response.read()).hexdigest() == digest
            except urllib.error.HTTPError:
                ready = False
        if ready:
            print('Los tres archivos publicados coinciden con el commit local.')
            print('Pendiente: prueba de interacción con una sesión de colaborador autorizado.')
            return
        print(f'Esperando publicación de Pages ({attempt + 1}/24)…', flush=True)
        time.sleep(10)
    raise RuntimeError('Push realizado, pero Pages aún no devuelve los archivos esperados; revisar el build.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        deploy(args.apply)
    except urllib.error.HTTPError as exc:
        sys.exit(f'Acceso HTTP rechazado ({exc.code}). No se muestran cuerpos ni credenciales.')
    except (RuntimeError, urllib.error.URLError, subprocess.CalledProcessError) as exc:
        sys.exit(str(exc))
