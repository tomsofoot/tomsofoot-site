-- À appliquer uniquement après validation. Aucune vue n'est attribuée à l'ouverture.
begin;
create table if not exists public.article_views (
  article_id uuid primary key references public.articles(id) on delete cascade,
  count bigint not null default 0 check (count >= 0)
);
create table if not exists public.article_view_sessions (
  article_id uuid not null references public.articles(id) on delete cascade,
  session_hash text not null check (session_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (article_id, session_hash)
);
create index if not exists article_view_sessions_created on public.article_view_sessions(created_at);
alter table public.article_views enable row level security;
alter table public.article_view_sessions enable row level security;
revoke all on public.article_views, public.article_view_sessions from public, anon, authenticated;

-- Lecture réservée au serveur ; même visibilité que la vue publique existante.
create or replace function public.article_view_state(p_article_id uuid, p_session_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.articles where id = p_article_id and
    (status = 'archived' or (status = 'published' and (published_at is null or published_at <= now())))) then
    raise exception 'article_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('count', coalesce((select count from public.article_views where article_id=p_article_id),0),
    'counted', exists(select 1 from public.article_view_sessions where article_id=p_article_id and session_hash=p_session_hash));
end;
$$;

create or replace function public.increment_article_view(p_article_id uuid, p_session_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare added integer;
begin
  if p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_session' using errcode = '22023';
  end if;
  perform public.article_view_state(p_article_id, p_session_hash);
  -- La contrainte unique et l'incrément font partie de la MÊME transaction.
  insert into public.article_view_sessions(article_id,session_hash) values(p_article_id,p_session_hash)
    on conflict do nothing;
  get diagnostics added = row_count;
  if added = 1 then
    insert into public.article_views(article_id,count) values(p_article_id,1)
      on conflict(article_id) do update set count=public.article_views.count+1;
  end if;
  return public.article_view_state(p_article_id,p_session_hash) || jsonb_build_object('incremented',added=1);
end;
$$;
revoke all on function public.article_view_state(uuid,text), public.increment_article_view(uuid,text) from public, anon, authenticated;
grant execute on function public.article_view_state(uuid,text), public.increment_article_view(uuid,text) to service_role;
commit;
