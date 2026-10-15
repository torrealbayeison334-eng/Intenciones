-- Each transition and its side effects happen in a single database transaction.
create table public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 2 and 100),
  role text not null check (role in ('priest', 'intercessor', 'admin')),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.intentions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique,
  name text not null check (length(name) between 2 and 100),
  message text not null check (length(message) between 10 and 2000),
  kind text not null default 'petition' check (kind in ('petition', 'gratitude')),
  status text not null default 'pending' check (status in ('pending', 'assigned', 'completed')),
  assigned_to uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  consent_version text not null default '2026-10-06',
  constraint intention_state check (
    (status = 'pending' and assigned_to is null and completed_at is null) or
    (status = 'assigned' and assigned_to is not null and completed_at is null) or
    (status = 'completed' and assigned_to is not null and completed_at is not null)
  )
);
create index intentions_available on public.intentions(status, created_at);
create index intentions_assignee on public.intentions(assigned_to, status);

-- Separate table: there is no email column in anything readable by priests.
create table public.intention_contacts (
  intention_id uuid primary key references public.intentions(id) on delete cascade,
  email text not null check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique,
  name text not null check (length(name) between 2 and 100),
  email text not null check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  community text not null check (length(community) between 3 and 200),
  message text not null check (length(message) between 10 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  invited_user_id uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index access_requests_email on public.access_requests(email, created_at);

create table public.email_jobs (
  id uuid primary key default gen_random_uuid(),
  intention_id uuid not null unique references public.intentions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'review')),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  lease_token uuid,
  provider_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_jobs_due on public.email_jobs(status, next_attempt_at);

alter table public.members enable row level security;
alter table public.intentions enable row level security;
alter table public.intention_contacts enable row level security;
alter table public.access_requests enable row level security;
alter table public.email_jobs enable row level security;

revoke all on public.members, public.intentions, public.intention_contacts, public.access_requests, public.email_jobs from anon, authenticated;
grant select on public.members, public.intentions to authenticated;
grant all on public.members, public.intentions, public.intention_contacts, public.access_requests, public.email_jobs to service_role;

create function public.is_intercessor() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and approved and role in ('priest', 'intercessor'));
$$;
revoke all on function public.is_intercessor() from public, anon, authenticated;
grant execute on function public.is_intercessor() to authenticated;

create policy own_membership on public.members for select to authenticated using (user_id = (select auth.uid()));
create policy available_intentions on public.intentions for select to authenticated using (
  public.is_intercessor() and (status = 'pending' or (status = 'assigned' and assigned_to = auth.uid()))
);

create function public.create_intention(p_submission_id uuid, p_name text, p_email text, p_message text, p_kind text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(lower(p_email), 0));
  select id into v_id from public.intentions where submission_id = p_submission_id;
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.intention_contacts c join public.intentions i on i.id = c.intention_id
      where c.email = lower(p_email) and i.created_at > now() - interval '1 hour') >= 3 then
    raise exception 'rate_limit';
  end if;
  insert into public.intentions(submission_id, name, message, kind)
    values(p_submission_id, trim(p_name), trim(p_message), p_kind) returning id into v_id;
  insert into public.intention_contacts(intention_id, email) values(v_id, lower(trim(p_email)));
  return v_id;
end;
$$;
revoke all on function public.create_intention(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_intention(uuid, text, text, text, text) to service_role;

create function public.create_access_request(p_submission_id uuid, p_name text, p_email text, p_community text, p_message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(lower(p_email), 1));
  select id into v_id from public.access_requests where submission_id = p_submission_id;
  if v_id is not null then return v_id; end if;
  if exists(select 1 from public.access_requests where email = lower(p_email) and created_at > now() - interval '1 day') then
    raise exception 'rate_limit';
  end if;
  insert into public.access_requests(submission_id, name, email, community, message)
    values(p_submission_id, trim(p_name), lower(trim(p_email)), trim(p_community), trim(p_message)) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_access_request(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_access_request(uuid, text, text, text, text) to service_role;

create function public.claim_intention(p_id uuid) returns setof public.intentions
language plpgsql security definer set search_path = '' as $$
declare v_row public.intentions;
begin
  if not public.is_intercessor() then raise exception 'not_authorized'; end if;
  update public.intentions set status = 'assigned', assigned_to = auth.uid()
    where id = p_id and status = 'pending' returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.intentions where id = p_id and status = 'assigned' and assigned_to = auth.uid();
    if v_row.id is null then raise exception 'intention_unavailable'; end if;
  end if;
  return next v_row;
end;
$$;
revoke all on function public.claim_intention(uuid) from public, anon, authenticated;
grant execute on function public.claim_intention(uuid) to authenticated;

create function public.complete_intention(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_row public.intentions;
begin
  if not public.is_intercessor() then raise exception 'not_authorized'; end if;
  select * into v_row from public.intentions where id = p_id for update;
  if v_row.id is null or v_row.assigned_to is distinct from auth.uid() then raise exception 'not_authorized'; end if;
  if v_row.status = 'completed' then return true; end if;
  if v_row.status <> 'assigned' then raise exception 'intention_unavailable'; end if;
  update public.intentions set status = 'completed', completed_at = now() where id = p_id;
  insert into public.email_jobs(intention_id) values(p_id) on conflict (intention_id) do nothing;
  return true;
end;
$$;
revoke all on function public.complete_intention(uuid) from public, anon, authenticated;
grant execute on function public.complete_intention(uuid) to authenticated;

create function public.release_intention(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_intercessor() then raise exception 'not_authorized'; end if;
  update public.intentions set status = 'pending', assigned_to = null
    where id = p_id and status = 'assigned' and assigned_to = auth.uid();
  if not found then raise exception 'intention_unavailable'; end if;
  return true;
end;
$$;
revoke all on function public.release_intention(uuid) from public, anon, authenticated;
grant execute on function public.release_intention(uuid) to authenticated;

-- Resend's idempotency window is 24h. Stop automatic retries before it expires.
create function public.take_email_job() returns table(id uuid, intention_id uuid, email text, lease_token uuid, attempts integer)
language plpgsql security definer set search_path = '' as $$
declare v_job public.email_jobs;
begin
  update public.email_jobs j set status = 'review', locked_until = null, last_error = 'retry_window_or_attempts_exceeded'
    where j.status in ('pending', 'processing') and (j.locked_until is null or j.locked_until < now())
    and (j.attempts >= 8 or j.first_attempt_at < now() - interval '23 hours');
  select j.* into v_job from public.email_jobs j
    where (j.status = 'pending' and j.next_attempt_at <= now()) or (j.status = 'processing' and j.locked_until < now())
    order by j.created_at for update skip locked limit 1;
  if v_job.id is null then return; end if;
  update public.email_jobs j set status = 'processing', attempts = j.attempts + 1,
    first_attempt_at = coalesce(j.first_attempt_at, now()), locked_until = now() + interval '5 minutes', lease_token = gen_random_uuid()
    where j.id = v_job.id returning j.* into v_job;
  return query select v_job.id, v_job.intention_id, c.email, v_job.lease_token, v_job.attempts
    from public.intention_contacts c where c.intention_id = v_job.intention_id;
end;
$$;
revoke all on function public.take_email_job() from public, anon, authenticated;
grant execute on function public.take_email_job() to service_role;

create function public.finish_email_job(p_id uuid, p_lease uuid, p_provider_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.email_jobs set status = 'sent', sent_at = now(), provider_id = p_provider_id, locked_until = null, last_error = null
    where id = p_id and lease_token = p_lease and status = 'processing';
  return found;
end;
$$;
revoke all on function public.finish_email_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.finish_email_job(uuid, uuid, text) to service_role;

create function public.retry_email_job(p_id uuid, p_lease uuid, p_error text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.email_jobs set status = 'pending', locked_until = null,
    next_attempt_at = now() + make_interval(secs => least(3600, (30 * power(2, attempts))::integer)), last_error = left(p_error, 100)
    where id = p_id and lease_token = p_lease and status = 'processing';
  return found;
end;
$$;
revoke all on function public.retry_email_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.retry_email_job(uuid, uuid, text) to service_role;

create function public.cleanup_personal_data() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.intentions where (status = 'completed' and completed_at < now() - interval '90 days')
    or (status in ('pending', 'assigned') and created_at < now() - interval '180 days');
  delete from public.access_requests where created_at < now() - interval '180 days';
end;
$$;
revoke all on function public.cleanup_personal_data() from public, anon, authenticated;
grant execute on function public.cleanup_personal_data() to service_role;
