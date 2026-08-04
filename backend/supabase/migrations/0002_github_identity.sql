-- Persist GitHub's immutable numeric identity alongside the changeable login.
alter table public.profiles
add column if not exists github_user_id bigint;

create unique index if not exists profiles_github_user_id_idx
on public.profiles(github_user_id)
where github_user_id is not null;

update public.profiles as profile
set github_user_id = case
  when coalesce(auth_user.raw_user_meta_data ->> 'provider_id', auth_user.raw_user_meta_data ->> 'sub', '') ~ '^[0-9]+$'
    then coalesce(auth_user.raw_user_meta_data ->> 'provider_id', auth_user.raw_user_meta_data ->> 'sub')::bigint
  else null
end
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.github_user_id is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  github_id bigint;
begin
  github_id := case
    when coalesce(new.raw_user_meta_data ->> 'provider_id', new.raw_user_meta_data ->> 'sub', '') ~ '^[0-9]+$'
      then coalesce(new.raw_user_meta_data ->> 'provider_id', new.raw_user_meta_data ->> 'sub')::bigint
    else null
  end;

  insert into public.profiles (id, github_user_id, github_login, github_avatar_url)
  values (
    new.id,
    github_id,
    coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'preferred_username'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    github_user_id = excluded.github_user_id,
    github_login = excluded.github_login,
    github_avatar_url = excluded.github_avatar_url,
    updated_at = pg_catalog.now();
  return new;
end;
$$;
