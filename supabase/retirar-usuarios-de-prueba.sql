-- MANDO · bloquea los tres usuarios de prueba del seed en una base de PRODUCCIÓN.
-- Pégalo en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
-- No los borra: el historial (bitácora, eventos creados, aprobaciones) los nombra y la bitácora no se borra.
-- Los bloquea para siempre, cambia su contraseña por una que nadie conoce y cierra sus sesiones abiertas.
--
-- ¡Antes! Si usaste torre@mando.test como tu cuenta de trabajo, pasa sus eventos y la administración
-- a tu cuenta real (ver README, «Retirar los usuarios de prueba»). Si no, te quedas sin Backend.

update auth.users
set banned_until = '2999-01-01',
    encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))
where id in ('00000000-0000-0000-0000-0000000000a1',
             '00000000-0000-0000-0000-0000000000a2',
             '00000000-0000-0000-0000-0000000000a3');

delete from auth.sessions
where user_id in ('00000000-0000-0000-0000-0000000000a1',
                  '00000000-0000-0000-0000-0000000000a2',
                  '00000000-0000-0000-0000-0000000000a3');

select email, banned_until from auth.users where email like '%@mando.test';
