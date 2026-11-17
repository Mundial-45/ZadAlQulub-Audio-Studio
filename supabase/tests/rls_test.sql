\set ON_ERROR_STOP off
\pset tuples_only on
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-000000000001','admin@x.org'),('bbbbbbbb-0000-0000-0000-000000000002','b@x.org'),('cccccccc-0000-0000-0000-000000000003','c@x.org');
update public.profiles set role='admin' where email='admin@x.org';
select 'perfiles creados por trigger: ' || count(*) from public.profiles;

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;

-- B
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select 'B ve perfiles (esperado 1): ' || count(*) from public.profiles;
update public.profiles set role='admin', display_name='Bee' where id='bbbbbbbb-0000-0000-0000-000000000002';
select 'B tras intentar ser admin: rol=' || role || ' nombre=' || display_name from public.profiles where id=auth.uid();
insert into public.recordings (content_id, category, user_id, file_path, mime_type) values ('azkar_5','x','bbbbbbbb-0000-0000-0000-000000000002','adhkar/azkar_5/bbbbbbbb-0000-0000-0000-000000000002/1.mp3','audio/mpeg');
select 'B inserta propia: estado=' || status || ' cat=' || category || ' v=' || version from public.recordings;
insert into public.recordings (content_id, category, user_id, file_path) values ('azkar_6','x','cccccccc-0000-0000-0000-000000000003','adhkar/azkar_6/cccccccc-0000-0000-0000-000000000003/1.mp3');
insert into public.recordings (content_id, category, user_id, file_path) values ('azkar_6','x','bbbbbbbb-0000-0000-0000-000000000002','adhkar/azkar_6/otro/1.mp3');
insert into public.recordings (content_id, category, user_id, file_path, status) values ('azkar_7','x','bbbbbbbb-0000-0000-0000-000000000002','adhkar/azkar_7/bbbbbbbb-0000-0000-0000-000000000002/1.mp3','published');
select 'B tras intentos (esperado pending): ' || string_agg(content_id||':'||status, ',') from public.recordings;
update public.recordings set status='approved';
select 'B intenta aprobar su propio audio (esperado pending): ' || status from public.recordings where content_id='azkar_5';
insert into public.published_audio (content_id, recording_id, version, file_path, current_path) select 'azkar_5', id, 1, 'a', 'b' from public.recordings;
-- storage
insert into storage.buckets(id,name) values ('zzz','zzz');
insert into storage.objects (bucket_id, name) values ('submissions','adhkar/azkar_5/bbbbbbbb-0000-0000-0000-000000000002/a.mp3');
insert into storage.objects (bucket_id, name) values ('submissions','adhkar/azkar_5/cccccccc-0000-0000-0000-000000000003/a.mp3');
insert into storage.objects (bucket_id, name) values ('published','adhkar/azkar_5.mp3');
select 'B objetos visibles (esperado 1): ' || count(*) from storage.objects;

-- C
select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'C ve grabaciones de B (esperado 0): ' || count(*) from public.recordings;
insert into storage.objects (bucket_id, name) values ('submissions','adhkar/azkar_9/cccccccc-0000-0000-0000-000000000003/a.mp3');
select 'C objetos visibles (esperado 1): ' || count(*) from storage.objects;

-- anónimo
reset role; set role anon;
select 'anon lee published_audio: ' || count(*) from public.published_audio;
select 'anon lee grabaciones: ' ||  count(*) from public.recordings;

-- admin
reset role; set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'admin ve grabaciones (esperado 1): ' || count(*) from public.recordings;
select 'admin ve perfiles (esperado 3): ' || count(*) from public.profiles;
update public.recordings set status='rejected' where content_id='azkar_5';
select 'rechazo sin motivo (esperado pending): ' || status from public.recordings where content_id='azkar_5';
update public.recordings set status='published' where content_id='azkar_5';
select 'publicar sin aprobar (esperado pending): ' || status from public.recordings where content_id='azkar_5';
update public.recordings set status='rejected', rejection_reason='Hay ruido' where content_id='azkar_5';
select 'rechazo con motivo: ' || status || ' / ' || rejection_reason || ' / revisor ok=' || (reviewed_by = auth.uid())::text from public.recordings where content_id='azkar_5';
update public.recordings set status='approved' where content_id='azkar_5';
update public.recordings set file_path='hack' where content_id='azkar_5';
select 'admin intenta cambiar file_path (esperado sin cambio): ' || (file_path<>'hack')::text from public.recordings where content_id='azkar_5';
update public.recordings set status='published' where content_id='azkar_5';
insert into public.published_audio (content_id, recording_id, version, file_path, current_path) select 'azkar_5', id, 1, 'adhkar/azkar_5_v1.mp3', 'adhkar/azkar_5.mp3' from public.recordings where content_id='azkar_5';
select 'admin publica: ' || count(*) from public.published_audio;
update public.profiles set role='collaborator' where id=auth.uid();
select 'admin se auto-degrada (esperado admin): ' || role from public.profiles where id=auth.uid();
update public.profiles set active=false where email='b@x.org';
insert into storage.objects (bucket_id, name) values ('published','adhkar/azkar_5.mp3');
select 'admin objetos (esperado 4): ' || count(*) from storage.objects;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
reset role; set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
insert into public.recordings (content_id, category, user_id, file_path) values ('azkar_8','x','bbbbbbbb-0000-0000-0000-000000000002','adhkar/azkar_8/bbbbbbbb-0000-0000-0000-000000000002/1.mp3');
select 'B desactivado no puede grabar (esperado 1 total): ' || count(*) from public.recordings;
