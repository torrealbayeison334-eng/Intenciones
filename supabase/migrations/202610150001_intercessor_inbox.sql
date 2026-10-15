-- Shared inbox. Apply after the two existing migrations. No notification emails.
-- Counts are cumulative and contain no intention text or contact details.
create table public.community_totals (
  singleton boolean primary key default true check(singleton),
  petitions bigint not null default 0,
  gratitudes bigint not null default 0,
  petitions_read bigint not null default 0,
  gratitudes_read bigint not null default 0,
  intercessors bigint not null default 0
);
insert into public.community_totals(singleton, petitions, gratitudes, petitions_read, gratitudes_read, intercessors)
select true,
  count(*) filter(where kind = 'petition'), count(*) filter(where kind = 'gratitude'),
  count(*) filter(where kind = 'petition' and status in ('assigned','completed')),
  count(*) filter(where kind = 'gratitude' and status in ('assigned','completed')),
  (select count(*) from public.members where approved and role in ('priest','intercessor'))
from public.intentions;
alter table public.community_totals enable row level security;
revoke all on public.community_totals from anon, authenticated;
grant select on public.community_totals to authenticated;
grant all on public.community_totals to service_role;
create policy intercessor_totals on public.community_totals for select to authenticated using((select public.is_intercessor()));

-- Stop the old notification pipeline, including already queued messages.
do $$ declare job record; begin
  if to_regclass('cron.job') is not null then
    for job in execute 'select jobid from cron.job where jobname = ''misterio-mail''' loop
      execute format('select cron.unschedule(%s)', job.jobid);
    end loop;
  end if;
end $$;
drop function public.claim_intention(uuid);
drop function public.complete_intention(uuid);
drop function public.release_intention(uuid);
drop function public.create_intention(uuid,text,text,text,text);
drop function public.take_email_job();
drop function public.finish_email_job(uuid,uuid,text);
drop function public.retry_email_job(uuid,uuid,text);
drop table public.email_jobs;
drop table public.intention_contacts;
drop policy available_intentions on public.intentions;
alter table public.intentions add column read_at timestamptz;
update public.intentions set read_at = case when status = 'completed' then completed_at else now() end where status in ('assigned','completed');
alter table public.intentions drop constraint intention_state;
alter table public.intentions drop column status, drop column assigned_to, drop column completed_at;
create index intentions_inbox on public.intentions(read_at, created_at desc, id);
-- Expired messages become inaccessible even between scheduled cleanup runs.
create policy shared_inbox on public.intentions for select to authenticated using(
  (select public.is_intercessor()) and (read_at is null or read_at > now() - interval '48 hours')
);

create table public.request_limits (
  key text not null,
  bucket timestamptz not null,
  attempts integer not null,
  primary key(key,bucket)
);
alter table public.request_limits enable row level security;
revoke all on public.request_limits from anon, authenticated;
grant all on public.request_limits to service_role;
create function public.check_request_limit(p_key text, p_limit integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_attempts integer;
begin
  if length(p_key) <> 64 or p_limit < 1 or p_limit > 100 then raise exception 'invalid_limit'; end if;
  insert into public.request_limits(key,bucket,attempts)
  values(p_key,date_trunc('hour',now()),1)
  on conflict(key,bucket) do update set attempts = public.request_limits.attempts + 1
  returning attempts into v_attempts;
  if v_attempts > p_limit then raise exception 'rate_limit'; end if;
end $$;
revoke all on function public.check_request_limit(text,integer) from public, anon, authenticated;
grant execute on function public.check_request_limit(text,integer) to service_role;

create function public.create_intention(p_submission_id uuid,p_name text,p_message text,p_kind text,p_rate_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_submission_id::text,0));
  select id into v_id from public.intentions where submission_id = p_submission_id;
  if v_id is not null then return v_id; end if;
  perform public.check_request_limit(p_rate_key,10);
  insert into public.intentions(submission_id,name,message,kind,consent_version)
  values(p_submission_id,trim(p_name),trim(p_message),p_kind,'2026-10-15') returning id into v_id;
  update public.community_totals set
    petitions = petitions + case when p_kind = 'petition' then 1 else 0 end,
    gratitudes = gratitudes + case when p_kind = 'gratitude' then 1 else 0 end;
  return v_id;
end $$;
revoke all on function public.create_intention(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.create_intention(uuid,text,text,text,text) to service_role;

-- Row locking ensures that two simultaneous opens count exactly one first read.
create function public.open_intention(p_id uuid) returns setof public.intentions
language plpgsql security definer set search_path = '' as $$
declare v_row public.intentions;
begin
  if not public.is_intercessor() then raise exception 'not_authorized'; end if;
  select * into v_row from public.intentions where id = p_id for update;
  if v_row.id is null or v_row.read_at <= now() - interval '48 hours' then raise exception 'intention_unavailable'; end if;
  if v_row.read_at is null then
    update public.intentions set read_at = now() where id = p_id returning * into v_row;
    update public.community_totals set
      petitions_read = petitions_read + case when v_row.kind = 'petition' then 1 else 0 end,
      gratitudes_read = gratitudes_read + case when v_row.kind = 'gratitude' then 1 else 0 end;
  end if;
  return next v_row;
end $$;
revoke all on function public.open_intention(uuid) from public, anon, authenticated;
grant execute on function public.open_intention(uuid) to authenticated;

create table public.intercessor_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check(username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  recovery_hash text not null check(length(recovery_hash)=64),
  recovery_pending_hash text check(length(recovery_pending_hash)=64),
  recovery_locked_until timestamptz
);
alter table public.intercessor_credentials enable row level security;
revoke all on public.intercessor_credentials from anon,authenticated;
grant all on public.intercessor_credentials to service_role;
create function public.register_intercessor(p_user_id uuid,p_username text,p_recovery_hash text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.intercessor_credentials(user_id,username,recovery_hash) values(p_user_id,p_username,p_recovery_hash);
  insert into public.members(user_id,display_name,role,approved) values(p_user_id,p_username,'intercessor',true);
  update public.community_totals set intercessors = intercessors + 1;
end $$;
revoke all on function public.register_intercessor(uuid,text,text) from public, anon, authenticated;
grant execute on function public.register_intercessor(uuid,text,text) to service_role;

-- Reserve the one-use recovery code before changing Auth's password. A failed
-- Auth call releases the reservation; concurrent recovery cannot reuse it.
create function public.reserve_recovery(p_username text,p_hash text,p_next_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.intercessor_credentials set recovery_pending_hash=p_next_hash, recovery_locked_until=now()+interval '2 minutes'
  where username=p_username and recovery_hash=p_hash
    and (recovery_locked_until is null or recovery_locked_until < now()) returning user_id into v_id;
  return v_id;
end $$;
create function public.finish_recovery(p_user_id uuid,p_next_hash text,p_success boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.intercessor_credentials set
    recovery_hash=case when p_success then p_next_hash else recovery_hash end,
    recovery_pending_hash=null,recovery_locked_until=null
  where user_id=p_user_id and recovery_pending_hash=p_next_hash;
  return found;
end $$;
revoke all on function public.reserve_recovery(text,text,text),public.finish_recovery(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.reserve_recovery(text,text,text),public.finish_recovery(uuid,text,boolean) to service_role;

create or replace function public.cleanup_personal_data() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.intentions where read_at <= now() - interval '48 hours';
  delete from public.request_limits where bucket < now() - interval '2 days';
  -- Legacy access requests are no longer collected by the public site.
  delete from public.access_requests where created_at < now() - interval '180 days';
end $$;
