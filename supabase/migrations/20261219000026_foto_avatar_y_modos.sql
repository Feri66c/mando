-- MANDO · Foto, avatar y modo de pantalla de cada persona (decisión 96).
--
-- 1. Cada persona tiene su foto. La sube ella misma o el backend de un evento donde trabajan juntos;
--    la persona siempre la ve y la puede cambiar, porque es su cara.
-- 2. Desde su foto, la persona crea su avatar con IA y elige qué se muestra: la foto o el avatar.
--    El avatar lo decide solo la persona: el backend no puede crearlo ni cambiarlo.
-- 3. Cada persona elige cómo ve MANDO: Neón, Sol (exterior, fondo claro) o Sobrio.
--
-- Archivos en el cubo privado: perfil/<persona>/<archivo>. Los ve quien puede ver a esa persona.

alter table profiles add column if not exists photo_path   text;
alter table profiles add column if not exists avatar_path  text;
alter table profiles add column if not exists show_avatar  boolean not null default false;
alter table profiles add column if not exists display_mode text not null default 'neon';
alter table profiles add column if not exists photo_by     uuid references profiles(id);

do $$
begin
  alter table profiles add constraint profiles_display_mode check (display_mode in ('neon', 'sol', 'sobrio'));
exception when duplicate_object then null;
end $$;

-- ¿Puede quien llama poner la foto de esta persona? Ella misma, o el backend de un evento en el que
-- esa persona es parte del equipo.
create or replace function public.can_set_photo_of(p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_profile = auth.uid()
      or exists (select 1 from event_members me
                 join event_members them on them.event_id = me.event_id
                 where me.profile_id = auth.uid() and me.role = 'backend'
                   and them.profile_id = p_profile and them.role <> 'viewer')
$$;

create or replace function public.profile_file_ok(p_profile uuid, p_name text) returns boolean
language sql immutable as $$
  select split_part(p_name, '/', 1) = 'perfil'
     and split_part(p_name, '/', 2) = p_profile::text
     and split_part(p_name, '/', 3) <> ''
     and split_part(p_name, '/', 4) = ''
     and p_name ~* '\.(png|jpe?g|webp)$'
$$;

create or replace function public._profile_of_file(p_name text) returns uuid
language plpgsql immutable as $$
begin
  if split_part(p_name, '/', 1) <> 'perfil'
     or split_part(p_name, '/', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return split_part(p_name, '/', 2)::uuid;
end $$;

create or replace function public.can_upload_profile_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_profile uuid := public._profile_of_file(p_name);
begin
  return v_profile is not null and public.profile_file_ok(v_profile, p_name) and public.can_set_photo_of(v_profile);
end $$;

create or replace function public.can_read_profile_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_profile uuid := public._profile_of_file(p_name);
begin
  return v_profile is not null and public.can_see_profile(v_profile);
end $$;

-- Foto: la pone la persona o su backend. Al cambiar la foto, el avatar viejo sigue hasta que ella cree otro.
create or replace function public.set_profile_photo(p_profile uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_set_photo_of(p_profile) then
    raise exception 'La foto la sube la persona o el productor general de su evento.' using errcode = '42501';
  end if;
  if p_path is not null and not public.profile_file_ok(p_profile, p_path) then
    raise exception 'La foto tiene que ser PNG, JPG o WebP.' using errcode = '22023';
  end if;
  update profiles set photo_path = p_path, photo_by = auth.uid(),
         show_avatar = case when p_path is null and avatar_path is null then false else show_avatar end
   where id = p_profile;
end $$;

-- Avatar: solo la persona.
create or replace function public.set_my_avatar(p_path text, p_show boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Vuelve a ingresar.' using errcode = '42501'; end if;
  if p_path is not null and not public.profile_file_ok(v_me, p_path) then
    raise exception 'El avatar tiene que ser PNG, JPG o WebP.' using errcode = '22023';
  end if;
  update profiles set avatar_path = p_path, show_avatar = (p_path is not null and coalesce(p_show, true)) where id = v_me;
end $$;

create or replace function public.set_my_look(p_show_avatar boolean, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Vuelve a ingresar.' using errcode = '42501'; end if;
  if p_mode is not null and p_mode not in ('neon', 'sol', 'sobrio') then
    raise exception 'Elige Neón, Sol o Sobrio.' using errcode = '22023';
  end if;
  update profiles
     set show_avatar = coalesce(p_show_avatar, show_avatar) and avatar_path is not null,
         display_mode = coalesce(p_mode, display_mode)
   where id = v_me;
end $$;

-- Nadie cambia estas columnas a mano: solo por las funciones de arriba.
create or replace function public._profiles_look_guard() returns trigger
language plpgsql as $$
begin
  if current_user = 'authenticated' and (
       new.photo_path is distinct from old.photo_path or new.avatar_path is distinct from old.avatar_path
    or new.show_avatar is distinct from old.show_avatar or new.display_mode is distinct from old.display_mode
    or new.photo_by is distinct from old.photo_by) then
    raise exception 'La foto, el avatar y el modo se cambian desde «Mi perfil».' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_look_guard on profiles;
create trigger profiles_look_guard before update on profiles
  for each row execute function public._profiles_look_guard();

do $$
declare f text;
begin
  execute 'revoke execute on function public._profiles_look_guard() from public, anon, authenticated';
  foreach f in array array[
    'public.can_set_photo_of(uuid)', 'public.profile_file_ok(uuid, text)', 'public._profile_of_file(text)',
    'public.can_upload_profile_file(text)', 'public.can_read_profile_file(text)',
    'public.set_profile_photo(uuid, text)', 'public.set_my_avatar(text, boolean)', 'public.set_my_look(boolean, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists perfil_files_insert on storage.objects;
    create policy perfil_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_profile_file(name));
    drop policy if exists perfil_files_read on storage.objects;
    create policy perfil_files_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_profile_file(name));
  end if;
end $$;
