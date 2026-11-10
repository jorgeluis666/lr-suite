// Configuración del proyecto de Supabase. Nada más: la clave anónima es pública por diseño (la
// protección son las políticas RLS de la base), pero este archivo no debe acumular lógica.
//
// SI SE CAMBIA DE PROYECTO hay que actualizar también la Content-Security-Policy del <head> de
// index.html; si no, el login y el tiempo real dejan de funcionar para todos.
//
// Aquí vivía installPendingButtonHitboxFix, un parche que inyectaba CSS con !important y volvía a
// disparar los clics que no llegaban a los botones de Pendientes. Las reglas pasaron al CSS de
// index.html, sin !important y junto al resto del tablero; el rescate en JavaScript se retiró
// porque, comprobado con la app corriendo, los botones ya reciben el clic ellos solos.
window.LR_SUITE_SUPABASE = {
  url: "https://brfsipssqfsuoplxxcth.supabase.co",
  anonKey: "sb_publishable_s2FCj70_2jkUO6viQ0TR5A_1mOvq9tj"
};
