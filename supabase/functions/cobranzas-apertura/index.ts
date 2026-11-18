import {createHandler} from './handler.mjs';
// Desplegar SOLO esta función con --no-verify-jwt: el lector del correo no tiene sesión.
Deno.serve(createHandler({url:Deno.env.get('SUPABASE_URL'), serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}));
