// Configuración pública de Supabase. La clave "anon" está pensada para ir en el navegador:
// la seguridad la imponen las políticas RLS. NUNCA pongas aquí la clave "service_role".
// Si se deja vacío, la aplicación funciona en modo local (sin inicio de sesión ni envío).
export const CONFIG = {
  SUPABASE_URL: '',        // p. ej. https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: ''    // clave pública "anon" / "publishable"
};
