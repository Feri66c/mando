-- MANDO · primer administrador de una instalación NUEVA de producción.
--
-- Pasos:
--   1. Corre supabase/instalar-todo.sql.
--   2. Supabase → Authentication → Users → Add user → Create new user: tu correo real,
--      marca «Auto Confirm User». No hace falta que recuerdes la contraseña: entrarás con código.
--   3. Pega este archivo en SQL Editor → Run. Crea la organización y hace administrador
--      (Backend que crea eventos) a la PRIMERA persona registrada que no sea de prueba.
--
-- Se puede correr más de una vez sin duplicar nada.

do $$
declare v_admin uuid; v_org uuid;
begin
  select id into v_admin from auth.users
  where email not like '%@mando.test' and banned_until is null
  order by created_at limit 1;
  if v_admin is null then
    raise exception 'Primero crea tu usuario en Authentication → Users → Add user.';
  end if;

  insert into profiles (id, full_name)
  select v_admin, coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1)) from auth.users where id = v_admin
  on conflict (id) do nothing;

  select organization_id into v_org from organization_members where is_admin limit 1;
  if v_org is null then
    insert into organizations (name) values ('Mi productora') returning id into v_org;
  end if;

  insert into organization_members (organization_id, profile_id, is_admin) values (v_org, v_admin, true)
  on conflict (organization_id, profile_id) do update set is_admin = true;
end $$;

select u.email, o.name as organizacion, om.is_admin as administrador
from organization_members om join auth.users u on u.id = om.profile_id join organizations o on o.id = om.organization_id;
