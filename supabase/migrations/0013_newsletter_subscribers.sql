begin;
-- Inscription uniquement. Aucun envoi de campagne n'est déclenché.
create table if not exists public.newsletter_subscribers (
 email text primary key check (email = lower(btrim(email)) and length(email) <= 254),
 created_at timestamptz not null default now(),
 consented_at timestamptz not null default now()
);
alter table public.newsletter_subscribers enable row level security;
revoke all on public.newsletter_subscribers from public, anon, authenticated;

create or replace function public.subscribe_newsletter(p_email text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare normalized text := lower(btrim(p_email)); added integer;
begin
 if p_consent is distinct from true then
  return jsonb_build_object('status','consent_required');
 end if;
 if normalized is null or length(normalized) > 254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
  return jsonb_build_object('status','invalid_email');
 end if;
 insert into public.newsletter_subscribers(email) values(normalized) on conflict (email) do nothing;
 get diagnostics added = row_count;
 return jsonb_build_object('status',case when added=1 then 'subscribed' else 'already_subscribed' end);
end;
$$;
revoke all on function public.subscribe_newsletter(text,boolean) from public, anon, authenticated;
grant execute on function public.subscribe_newsletter(text,boolean) to service_role;
commit;
