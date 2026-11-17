-- =====================================================================================
-- ZadALQulub Audio Studio · esquema de Supabase (PostgreSQL + Storage + RLS)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run. Después, seed.sql.
-- No usa nunca la clave service_role: toda la seguridad la imponen las políticas RLS.
-- =====================================================================================

-- ---------- Tablas ------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'collaborator' check (role in ('admin', 'collaborator')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.categories (
  key      text primary key,            -- azkar | adya | ruqyah | munajat (igual que en ZadALQulub)
  folder   text not null,               -- carpeta en Storage: adhkar | adiya | ruqya | munajat
  title_ar text, title_es text, title_fr text,
  sort     int not null default 0
);

-- Solo identificadores y referencias (no se duplican los textos de ZadALQulub).
create table if not exists public.content_items (
  id              text primary key,     -- p. ej. azkar_116 = <sección>_<itemNumber> de ZadALQulub
  category        text not null references public.categories(key),
  item_number     int  not null,
  group_id        text,
  same_text_group text not null,        -- id canónico del grupo de items con el mismo texto árabe
  unique (category, item_number)
);
create index if not exists content_items_group_idx on public.content_items(same_text_group);

do $$ begin
  create type public.recording_status as enum ('pending', 'approved', 'rejected', 'published');
exception when duplicate_object then null; end $$;

create table if not exists public.recordings (
  id               uuid primary key default gen_random_uuid(),
  content_id       text not null references public.content_items(id),
  category         text not null references public.categories(key),
  user_id          uuid not null references public.profiles(id),
  version          int  not null default 1,
  file_path        text not null,       -- MP3 en el bucket privado "submissions"
  original_path    text,                -- WAV original opcional
  mime_type        text not null default 'audio/mpeg',
  duration_seconds numeric(8,2),
  size_bytes       bigint,
  status           public.recording_status not null default 'pending',
  created_at       timestamptz not null default now(),
  submitted_at     timestamptz not null default now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid references public.profiles(id),
  rejection_reason text,
  constraint rejected_needs_reason check (status <> 'rejected' or length(btrim(coalesce(rejection_reason, ''))) > 0)
);
create index if not exists recordings_content_idx on public.recordings(content_id);
create index if not exists recordings_user_idx    on public.recordings(user_id);
create index if not exists recordings_status_idx  on public.recordings(status);

create table if not exists public.published_audio (
  id            uuid primary key default gen_random_uuid(),
  content_id    text not null references public.content_items(id),
  recording_id  uuid not null references public.recordings(id),
  version       int  not null,
  file_path     text not null,          -- copia inmutable de esta versión (published/<carpeta>/<id>_v<N>.mp3)
  current_path  text not null,          -- ruta estable de la versión vigente (published/<carpeta>/<id>.mp3)
  is_current    boolean not null default true,
  published_by  uuid references public.profiles(id),
  published_at  timestamptz not null default now(),
  unique (content_id, version)
);
create unique index if not exists published_one_current on public.published_audio(content_id) where is_current;

-- ---------- Funciones auxiliares ----------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active)
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

-- Perfil automático al crear un usuario (invitación desde el panel de Supabase).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Un colaborador solo puede cambiar su nombre; el rol y el estado solo los cambia un administrador (y no el suyo propio).
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;          -- SQL Editor / mantenimiento
  if not public.is_admin() then
    new.role := old.role; new.active := old.active; new.email := old.email;
  elsif old.id = auth.uid() then
    new.role := old.role; new.active := old.active;       -- evita que un admin se quite el acceso
  end if;
  return new;
end $$;
drop trigger if exists protect_profile_trg on public.profiles;
create trigger protect_profile_trg before update on public.profiles for each row execute function public.protect_profile();

-- Al insertar una grabación: categoría y versión las fija el servidor; siempre empieza "pending".
create or replace function public.recordings_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select category into new.category from public.content_items where id = new.content_id;
  if new.category is null then raise exception 'content_id desconocido: %', new.content_id; end if;
  select coalesce(max(version), 0) + 1 into new.version from public.recordings where content_id = new.content_id;
  new.status := 'pending'; new.submitted_at := now(); new.reviewed_at := null; new.reviewed_by := null; new.rejection_reason := null;
  return new;
end $$;
drop trigger if exists recordings_before_insert_trg on public.recordings;
create trigger recordings_before_insert_trg before insert on public.recordings for each row execute function public.recordings_before_insert();

-- Al revisar: solo cambia el estado; se registra quién y cuándo. El archivo y el autor no se pueden alterar.
create or replace function public.recordings_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.file_path is distinct from old.file_path or new.user_id is distinct from old.user_id
     or new.content_id is distinct from old.content_id or new.original_path is distinct from old.original_path
     or new.version is distinct from old.version then
    raise exception 'Campos inmutables de la grabación';
  end if;
  if new.status is distinct from old.status then
    new.reviewed_at := now(); new.reviewed_by := auth.uid();
    if new.status = 'published' and old.status <> 'approved' and old.status <> 'published' then
      raise exception 'Solo se puede publicar una grabación aprobada';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists recordings_before_update_trg on public.recordings;
create trigger recordings_before_update_trg before update on public.recordings for each row execute function public.recordings_before_update();

-- ---------- RLS: tablas -------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.categories      enable row level security;
alter table public.content_items   enable row level security;
alter table public.recordings      enable row level security;
alter table public.published_audio enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to authenticated using (true);
drop policy if exists content_items_read on public.content_items;
create policy content_items_read on public.content_items for select to authenticated using (true);

drop policy if exists recordings_select on public.recordings;
create policy recordings_select on public.recordings for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists recordings_insert on public.recordings;
create policy recordings_insert on public.recordings for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_active_user()
    and file_path like ((select folder from public.categories where key = category) || '/' || content_id || '/' || auth.uid()::text || '/%'));
drop policy if exists recordings_update_admin on public.recordings;
create policy recordings_update_admin on public.recordings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Lo publicado es público (ZadALQulub solo lee esto). Nunca se exponen pendientes ni rechazadas.
drop policy if exists published_read on public.published_audio;
create policy published_read on public.published_audio for select to anon, authenticated using (true);
drop policy if exists published_insert on public.published_audio;
create policy published_insert on public.published_audio for insert to authenticated with check (public.is_admin());
drop policy if exists published_update on public.published_audio;
create policy published_update on public.published_audio for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.categories, public.content_items to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.recordings to authenticated;
grant select on public.published_audio to anon;
grant select, insert, update on public.published_audio to authenticated;

-- ---------- Storage -----------------------------------------------------------------
-- submissions (privado): <carpeta>/<content_id>/<user_id>/<archivo>   ·   published (público): <carpeta>/<archivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('submissions', 'submissions', false, 52428800, array['audio/mpeg', 'audio/wav', 'audio/x-wav']),
  ('published',   'published',   true,  52428800, array['audio/mpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sub_insert on storage.objects;
create policy sub_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions' and public.is_active_user() and (storage.foldername(name))[3] = auth.uid()::text);
drop policy if exists sub_select on storage.objects;
create policy sub_select on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and ((storage.foldername(name))[3] = auth.uid()::text or public.is_admin()));
drop policy if exists sub_admin_delete on storage.objects;
create policy sub_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'submissions' and public.is_admin());

drop policy if exists pub_select on storage.objects;
create policy pub_select on storage.objects for select to anon, authenticated using (bucket_id = 'published');
drop policy if exists pub_insert on storage.objects;
create policy pub_insert on storage.objects for insert to authenticated with check (bucket_id = 'published' and public.is_admin());
drop policy if exists pub_update on storage.objects;
create policy pub_update on storage.objects for update to authenticated using (bucket_id = 'published' and public.is_admin()) with check (bucket_id = 'published' and public.is_admin());
drop policy if exists pub_delete on storage.objects;
create policy pub_delete on storage.objects for delete to authenticated using (bucket_id = 'published' and public.is_admin());
