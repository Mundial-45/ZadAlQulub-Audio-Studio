# Pruebas de permisos (RLS) en un PostgreSQL local

```bash
createdb t
psql -d t -f supabase/tests/local_stubs.sql
psql -d t -f supabase/schema.sql
psql -d t -f supabase/seed.sql
psql -d t -f supabase/tests/rls_test.sql
```

Cada línea del resultado indica lo esperado. Se comprobó que: un colaborador solo ve y envía lo suyo y no puede cambiar su rol ni
aprobar audios; no puede escribir en carpetas de otros ni en `published`; un rechazo exige motivo; no se publica lo no aprobado;
el archivo de una grabación es inmutable; un administrador no puede quitarse su propio acceso; un usuario desactivado no puede grabar;
el público anónimo solo lee `published_audio` y nunca las grabaciones.
