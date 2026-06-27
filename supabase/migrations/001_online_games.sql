create table if not exists public.gungi_games (
  id text primary key,
  status text not null default 'setup'
    check (status in ('setup', 'battle', 'finished')),
  current_state jsonb not null,
  move_count integer not null default 0 check (move_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gungi_game_moves (
  id bigint generated always as identity primary key,
  game_id text not null references public.gungi_games(id) on delete cascade,
  move_number integer not null check (move_number > 0),
  client_id text not null,
  player_color text check (player_color in ('blue', 'red')),
  phase text not null check (phase in ('setup', 'battle')),
  move_type text not null check (move_type in ('place', 'move', 'pass', 'start_battle')),
  piece_id text,
  piece_type text,
  from_row smallint,
  from_col smallint,
  to_row smallint,
  to_col smallint,
  captured_piece_id text,
  state_after jsonb not null,
  created_at timestamptz not null default now(),
  unique (game_id, move_number)
);

create index if not exists gungi_game_moves_game_id_id_idx
  on public.gungi_game_moves (game_id, id);

alter table public.gungi_games enable row level security;
alter table public.gungi_game_moves enable row level security;

grant select, insert, update on table public.gungi_games to anon, authenticated;
grant select, insert on table public.gungi_game_moves to anon, authenticated;
grant usage, select on sequence public.gungi_game_moves_id_seq to anon, authenticated;

drop policy if exists "Anyone can read gungi games by room id" on public.gungi_games;
create policy "Anyone can read gungi games by room id"
on public.gungi_games
for select
to anon, authenticated
using (true);

drop policy if exists "Anyone can create gungi games" on public.gungi_games;
create policy "Anyone can create gungi games"
on public.gungi_games
for insert
to anon, authenticated
with check (true);

drop policy if exists "Anyone can update gungi games" on public.gungi_games;
create policy "Anyone can update gungi games"
on public.gungi_games
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Anyone can read gungi moves" on public.gungi_game_moves;
create policy "Anyone can read gungi moves"
on public.gungi_game_moves
for select
to anon, authenticated
using (true);

drop policy if exists "Anyone can append gungi moves" on public.gungi_game_moves;
create policy "Anyone can append gungi moves"
on public.gungi_game_moves
for insert
to anon, authenticated
with check (true);

do $$
begin
  alter publication supabase_realtime add table public.gungi_games;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.gungi_game_moves;
exception
  when duplicate_object then null;
end $$;
