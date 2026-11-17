-- Jalankan sekali di Supabase Dashboard > SQL Editor.
-- Tidak membuat akun SPV atau menyimpan password. Akun dibuat di Authentication > Users.
begin;
create table if not exists public.rt_assessments (
 id uuid primary key,
 profile jsonb not null check (jsonb_typeof(profile) = 'object'),
 answers jsonb not null check (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) = 38),
 scores jsonb not null check (jsonb_typeof(scores) = 'array'),
 ai jsonb not null check (jsonb_typeof(ai) = 'object'),
 note text not null default '' check (char_length(note) <= 3000),
 created_at timestamptz not null default now(),
 assessment_version integer not null default 2 check (assessment_version = 2),
 consent_version integer not null default 1
);
create index if not exists rt_assessments_created_at_idx on public.rt_assessments (created_at desc);
alter table public.rt_assessments enable row level security;
-- Intentionally no client-facing RLS policies. Only Vercel's service-role requests may read/write.
revoke all on public.rt_assessments from public, anon, authenticated;
grant select, insert, update on public.rt_assessments to service_role;

create table if not exists public.rt_rate_limits (
 rate_key text primary key,
 attempts integer not null,
 expires_at timestamptz not null
);
alter table public.rt_rate_limits enable row level security;
revoke all on public.rt_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.rt_rate_limits to service_role;

create or replace function public.rt_check_rate_limit(p_key text, p_limit integer, p_window_seconds integer default 3600)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare new_count integer;
begin
 if char_length(p_key) <> 64 or p_limit < 1 or p_limit > 1000 or p_window_seconds < 60 or p_window_seconds > 86400 then
  raise exception 'Invalid rate limit parameters';
 end if;
 insert into public.rt_rate_limits as existing (rate_key, attempts, expires_at)
 values (p_key, 1, now() + make_interval(secs => p_window_seconds))
 on conflict (rate_key) do update
 set attempts = case when existing.expires_at <= now() then 1 else existing.attempts + 1 end,
 expires_at = case when existing.expires_at <= now() then now() + make_interval(secs => p_window_seconds) else existing.expires_at end
 returning attempts into new_count;
 return new_count <= p_limit;
end;
$$;
revoke all on function public.rt_check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rt_check_rate_limit(text, integer, integer) to service_role;
commit;
