-- PostgREST sessions preload safeupdate. Scope every counter UPDATE to the
-- singleton row so registration, submission and first reads work through HTTP.
-- CREATE OR REPLACE preserves the existing service-only/client EXECUTE grants.
create or replace function public.create_intention(p_submission_id uuid,p_name text,p_message text,p_kind text,p_rate_key text)
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
    gratitudes = gratitudes + case when p_kind = 'gratitude' then 1 else 0 end
  where singleton = true;
  return v_id;
end $$;

create or replace function public.open_intention(p_id uuid) returns setof public.intentions
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
      gratitudes_read = gratitudes_read + case when v_row.kind = 'gratitude' then 1 else 0 end
    where singleton = true;
  end if;
  return next v_row;
end $$;

create or replace function public.register_intercessor(p_user_id uuid,p_username text,p_recovery_hash text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.intercessor_credentials(user_id,username,recovery_hash) values(p_user_id,p_username,p_recovery_hash);
  insert into public.members(user_id,display_name,role,approved) values(p_user_id,p_username,'intercessor',true);
  update public.community_totals set intercessors = intercessors + 1 where singleton = true;
end $$;
