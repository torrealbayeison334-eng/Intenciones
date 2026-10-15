create function public.find_auth_user(p_email text) returns uuid
language sql security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function public.find_auth_user(text) from public, anon, authenticated;
grant execute on function public.find_auth_user(text) to service_role;

create function public.approve_access_request(p_id uuid, p_user_id uuid, p_admin_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_request public.access_requests;
begin
  if not exists (select 1 from public.members where user_id = p_admin_id and role = 'admin' and approved) then raise exception 'not_authorized'; end if;
  select * into v_request from public.access_requests where id = p_id for update;
  if v_request.id is null then raise exception 'not_found'; end if;
  if v_request.status = 'approved' then return true; end if;
  if v_request.status <> 'pending' then raise exception 'already_reviewed'; end if;
  if not exists (select 1 from auth.users where id = p_user_id and lower(email) = v_request.email) then raise exception 'identity_mismatch'; end if;
  -- Never overwrite or downgrade an existing admin or other membership.
  insert into public.members(user_id, display_name, role, approved) values(p_user_id, v_request.name, 'priest', true)
    on conflict (user_id) do nothing;
  update public.access_requests set status = 'approved', invited_user_id = p_user_id, reviewed_by = p_admin_id, reviewed_at = now() where id = p_id;
  return true;
end;
$$;
revoke all on function public.approve_access_request(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_access_request(uuid, uuid, uuid) to service_role;
