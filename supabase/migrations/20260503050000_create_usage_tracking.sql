create table public.user_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null, -- Format 'YYYY-MM'
  usage_count integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(user_id, month)
);

-- Enable RLS but since this is updated by the worker via service role, we can just deny all public access
alter table public.user_usage enable row level security;

create policy "Users can view their own usage"
  on public.user_usage for select
  using ( auth.uid() = user_id );

-- Atomic increment RPC
create or replace function public.increment_user_usage(p_user_id uuid, p_month text)
returns integer
language plpgsql
security definer
as $$
declare
  current_count integer;
begin
  insert into public.user_usage (user_id, month, usage_count, created_at, updated_at)
  values (p_user_id, p_month, 1, now(), now())
  on conflict (user_id, month) do update
  set 
    usage_count = public.user_usage.usage_count + 1,
    updated_at = now()
  returning usage_count into current_count;

  return current_count;
end;
$$;
