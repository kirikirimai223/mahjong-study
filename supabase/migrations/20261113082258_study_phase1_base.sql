-- 麻雀勉強会支援ツール（Phase 1）。同じプロジェクトの他アプリと混ざらないよう study_ 接頭辞で分ける
create table public.study_members (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.study_invites (
  email text primary key check (email = lower(email)),
  invited_by uuid references public.study_members(id) on delete set null,
  invited_at timestamptz not null default now()
);

-- RLS から呼ぶ判定（security definer で study_members の RLS を回避）
create or replace function public.study_is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.study_members m where m.id = auth.uid());
$$;
create or replace function public.study_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.study_members m where m.id = auth.uid() and m.is_admin);
$$;

-- ログインしたユーザーが招待されていれば members に入れる（初回ログイン時に呼ぶ）
create or replace function public.study_join() returns public.study_members
language plpgsql security definer set search_path = '' as $$
declare
  u_email text;
  m public.study_members;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into m from public.study_members where id = auth.uid();
  if found then return m; end if;
  select lower(email) into u_email from auth.users where id = auth.uid();
  if not exists (select 1 from public.study_invites i where i.email = u_email) then
    raise exception 'not invited' using errcode = '42501';
  end if;
  insert into public.study_members (id, display_name) values (auth.uid(), split_part(u_email, '@', 1)) returning * into m;
  return m;
end;
$$;

create or replace function public.study_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  held_on date not null,
  title text not null default '',
  participants text[] not null default '{}',
  note text not null default '',
  created_by uuid references public.study_members(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.study_games (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.study_sessions(id) on delete set null,
  name text not null default '',
  rule jsonb not null default '{"disp":"般南喰赤","aka":1}',
  player_names text[] not null default '{}',
  created_by uuid references public.study_members(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.study_rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references public.study_games(id) on delete set null,
  kyoku smallint not null check (kyoku between 0 and 7),
  honba smallint not null default 0 check (honba >= 0),
  label text not null default '',
  summary text not null default '',
  editor jsonb not null,
  tenhou_json jsonb,
  randomized_seats smallint[] not null default '{}',
  updated_by uuid references public.study_members(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.study_positions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.study_rounds(id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  discard_index int not null check (discard_index >= 0),
  conclusion text not null default '',
  conclusion_by uuid references public.study_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (round_id, seat, discard_index)
);
create table public.study_comments (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.study_rounds(id) on delete cascade,
  position_id uuid references public.study_positions(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.study_members(id) on delete cascade,
  speaker text not null default '',
  body text not null check (length(body) > 0),
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.study_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.study_rounds(id) on delete cascade,
  engine text not null check (engine in ('naga', 'mortal', 'other')),
  report_url text not null,
  note text not null default '',
  created_by uuid references public.study_members(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index on public.study_games (session_id);
create index on public.study_rounds (game_id);
create index on public.study_positions (round_id);
create index on public.study_comments (round_id);
create index on public.study_comments (position_id);
create index on public.study_ai_reviews (round_id);

create trigger study_sessions_touch before update on public.study_sessions for each row execute function public.study_touch();
create trigger study_games_touch before update on public.study_games for each row execute function public.study_touch();
create trigger study_rounds_touch before update on public.study_rounds for each row execute function public.study_touch();
create trigger study_positions_touch before update on public.study_positions for each row execute function public.study_touch();
create trigger study_comments_touch before update on public.study_comments for each row execute function public.study_touch();

-- RLS：1グループ前提。メンバーは全部読めて、記録は誰でも作成・編集。コメントは本人だけ編集
alter table public.study_members enable row level security;
alter table public.study_invites enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_games enable row level security;
alter table public.study_rounds enable row level security;
alter table public.study_positions enable row level security;
alter table public.study_comments enable row level security;
alter table public.study_ai_reviews enable row level security;

create policy "members read members" on public.study_members for select to authenticated using (public.study_is_member());
create policy "update own name" on public.study_members for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and is_admin = (select m.is_admin from public.study_members m where m.id = auth.uid()));
create policy "admin manages invites" on public.study_invites for all to authenticated using (public.study_is_admin()) with check (public.study_is_admin());

create policy "members all" on public.study_sessions for all to authenticated using (public.study_is_member()) with check (public.study_is_member());
create policy "members all" on public.study_games for all to authenticated using (public.study_is_member()) with check (public.study_is_member());
create policy "members all" on public.study_rounds for all to authenticated using (public.study_is_member()) with check (public.study_is_member());
create policy "members all" on public.study_positions for all to authenticated using (public.study_is_member()) with check (public.study_is_member());
create policy "members all" on public.study_ai_reviews for all to authenticated using (public.study_is_member()) with check (public.study_is_member());

create policy "members read comments" on public.study_comments for select to authenticated using (public.study_is_member());
create policy "members write own comments" on public.study_comments for insert to authenticated with check (public.study_is_member() and author_id = auth.uid());
create policy "author updates comment" on public.study_comments for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "author deletes comment" on public.study_comments for delete to authenticated using (author_id = auth.uid());

revoke all on function public.study_join() from public, anon;
grant execute on function public.study_join() to authenticated;
revoke all on function public.study_is_member() from public, anon;
revoke all on function public.study_is_admin() from public, anon;
grant execute on function public.study_is_member() to authenticated;
grant execute on function public.study_is_admin() to authenticated;
revoke all on public.study_members, public.study_invites, public.study_sessions, public.study_games, public.study_rounds, public.study_positions, public.study_comments, public.study_ai_reviews from anon;
