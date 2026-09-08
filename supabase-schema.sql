-- ShareMusic Supabase setup
-- Run this in Supabase SQL Editor before using the static app.

create table if not exists public.rooms (
  id text primary key,
  track_id uuid,
  status text not null default 'idle' check (status in ('idle', 'counting', 'running', 'paused', 'ended')),
  start_at timestamptz,
  paused_at_ms integer,
  updated_at timestamptz not null default now()
);

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  storage_path text not null unique,
  public_url text not null,
  size_bytes bigint not null default 0,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.rooms (id) values ('main') on conflict (id) do nothing;

alter table public.rooms enable row level security;
alter table public.tracks enable row level security;
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Listener clients can read the current room and available tracks.
drop policy if exists "room is publicly readable" on public.rooms;
create policy "room is publicly readable" on public.rooms for select using (true);

drop policy if exists "tracks are publicly readable" on public.tracks;
create policy "tracks are publicly readable" on public.tracks for select using (true);

-- Only authenticated admins may mutate room state and track records.
drop policy if exists "authenticated admins control rooms" on public.rooms;
create policy "authenticated admins control rooms" on public.rooms for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated admins insert tracks" on public.tracks;
create policy "authenticated admins insert tracks" on public.tracks for insert to authenticated with check (public.is_admin());

drop policy if exists "authenticated admins update tracks" on public.tracks;
create policy "authenticated admins update tracks" on public.tracks for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated admins delete tracks" on public.tracks;
create policy "authenticated admins delete tracks" on public.tracks for delete to authenticated using (public.is_admin());

-- Create a public Storage bucket named "tracks" in the dashboard, then run:
-- insert into storage.buckets (id, name, public) values ('tracks', 'tracks', true) on conflict (id) do update set public = true;

drop policy if exists "public can read track files" on storage.objects;
create policy "public can read track files" on storage.objects for select using (bucket_id = 'tracks');

drop policy if exists "authenticated admins upload track files" on storage.objects;
create policy "authenticated admins upload track files" on storage.objects for insert to authenticated with check (bucket_id = 'tracks' and public.is_admin());

drop policy if exists "authenticated admins delete track files" on storage.objects;
create policy "authenticated admins delete track files" on storage.objects for delete to authenticated using (bucket_id = 'tracks' and public.is_admin());

-- Enable database change delivery for the room table.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
end
$$;

-- After creating the admin user in Supabase Authentication, register it:
-- insert into public.admins (user_id) values ('AUTH_USER_UUID');
