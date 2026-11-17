# Puesta en marcha paso a paso

## 1. Publicar la aplicación (GitHub Pages)
1. GitHub → repo `ZadAlQulub-Audio-Studio` → **Settings → Pages**.
2. *Source*: **Deploy from a branch** · Branch `main` · carpeta `/ (root)` → **Save**.
3. Dirección: `https://mundial-45.github.io/ZadAlQulub-Audio-Studio/`

Sin más pasos, la aplicación ya funciona en **modo local** (graba, edita, procesa y guarda en el dispositivo).

## 2. Crear el proyecto en Supabase
1. https://supabase.com → **New project** (elige región cercana y guarda la contraseña de la base de datos).
2. **SQL Editor → New query**: pega el contenido de `supabase/schema.sql` → **Run**.
3. Otra consulta nueva con `supabase/seed.sql` → **Run** (carga las 4 categorías y los 867 identificadores).
4. **Storage**: deben existir los buckets `submissions` (privado) y `published` (público); los crea el paso 2.

## 3. Usuarios
1. **Authentication → Providers → Email**: desactiva *Allow new users to sign up* (solo por invitación).
2. **Authentication → URL Configuration**: *Site URL* = la dirección de GitHub Pages del paso 1.
3. **Authentication → Users → Invite user** con tu correo (o *Add user → Create new user* con contraseña).
4. Hazte administrador (SQL Editor):
   ```sql
   update public.profiles set role = 'admin' where email = 'TU_CORREO';
   ```
5. A cada colaborador: **Invite user**. Recibirá un correo, abrirá el enlace y la aplicación le pedirá elegir su contraseña.
   Desde el panel *Administración → Colaboradores* puedes activar, desactivar o cambiar el rol.

## 3b. Conectar la aplicación
En **Project Settings → API** copia *Project URL* y la clave **anon / publishable** y pégalas en `config.js`:
```js
export const CONFIG = { SUPABASE_URL: 'https://xxxx.supabase.co', SUPABASE_ANON_KEY: 'eyJ...' };
```
Haz commit. **Nunca** pongas la clave `service_role`.

## 4. Flujo de trabajo
- **Colaborador**: Textos → *Grabar* → editar → *Procesar* → *Generar MP3* → escuchar → **Enviar para revisión**. Ve el estado en *Mis grabaciones* y, si se rechaza, el motivo; puede grabar de nuevo.
- **Administrador**: *Administración → Grabaciones*: filtra, escucha, **Aprobar / Rechazar (con motivo)**, y **Publicar**. Al publicar se muestra la URL pública del MP3 (`.../published/<carpeta>/<id>.mp3?v=N`) y un botón para copiarla; pégala a mano en `audioUrls` de ZadALQulub cuando quieras sustituir el audio. El historial de versiones permite volver a una anterior.
- Los textos con el mismo contenido (`sameTextAs`) se marcan como hechos automáticamente al grabar uno de ellos.

## 5. Seguridad
- Solo se usa la clave pública `anon`; toda la protección está en las políticas RLS de `supabase/schema.sql` (probadas, ver `supabase/tests`).
- Los envíos pendientes están en un bucket privado; solo su autor y los administradores pueden escucharlos.
- Nada se publica sin aprobación y publicación manual del administrador.
- Revisa en Supabase los límites de almacenamiento y de tamaño de archivo de tu plan antes de subir muchos audios.
