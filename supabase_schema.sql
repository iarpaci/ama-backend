-- Run this in Supabase SQL Editor

-- User subscriptions table
create table if not exists user_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial' check (plan in ('trial', 'basic', 'pro')),
  message_count integer not null default 0,        -- lifetime count (trial)
  monthly_message_count integer not null default 0, -- monthly count (basic)
  period_start timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Messages table (conversation history)
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx on messages(conversation_id);
create index if not exists messages_user_id_idx on messages(user_id);

-- Row Level Security
alter table user_subscriptions enable row level security;
alter table messages enable row level security;

-- Service role bypasses RLS (backend uses service role key)
-- Users cannot read others' data via client

-- RPC: increment trial message count
create or replace function increment_message_count(p_user_id uuid)
returns void language plpgsql security definer as $$
begin
  update user_subscriptions
  set message_count = message_count + 1, updated_at = now()
  where user_id = p_user_id;
end;
$$;

-- RPC: increment monthly message count
create or replace function increment_monthly_message_count(p_user_id uuid)
returns void language plpgsql security definer as $$
begin
  update user_subscriptions
  set monthly_message_count = monthly_message_count + 1, updated_at = now()
  where user_id = p_user_id;
end;
$$;
