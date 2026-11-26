-- MANDO · Permisos explícitos para el rol «authenticated» (decisión 49).
--
-- Los proyectos nuevos de Supabase ya no dan acceso automático a las tablas del esquema public:
-- sin estos permisos la app responde «permission denied for table …» aunque la persona haya entrado.
--
-- Esto NO relaja la seguridad por fila: cada tabla sigue con RLS y sin políticas de escritura,
-- así que solo se lee lo que las políticas dejan y todo se escribe por las funciones.
-- Quien no ha iniciado sesión (anon) no recibe ningún permiso sobre las tablas.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Funciones que usa la app. Quedan fuera las internas (empiezan con «_»), los disparadores
-- y las dos que ya estaban cerradas a propósito.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname not like '\_%'
       and p.proname not in ('event_role_of', 'run_clock_rules_all')
       and p.prorettype <> 'trigger'::regtype
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('grant execute on function %s to authenticated', r.fn);
  end loop;
end $$;
grant execute on function public.invitation_pending(text) to anon;

-- Lo que se cree más adelante nace con los mismos permisos.
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
