-- NexIDE security hardening — run once in the Supabase SQL editor.
-- Safe to re-run.

begin;

-- 1. Purge credentials that older app versions synced into user_settings.
--    (The service_role key was public, so treat any stored keys as compromised.)
update public.user_settings
set settings = settings - 'geminiApiKey' - 'githubToken'
where settings ?| array['geminiApiKey', 'githubToken'];

-- 2. Recreate RLS policies with explicit WITH CHECK and a cached auth.uid().
drop policy if exists "Users can manage their own settings" on public.user_settings;
create policy "Users can manage their own settings" on public.user_settings
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users can manage their own projects" on public.projects;
create policy "Users can manage their own projects" on public.projects
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can manage files in their projects" on public.files;
create policy "Users can manage files in their projects" on public.files
  for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = files.project_id and p.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = files.project_id and p.owner_id = (select auth.uid())
  ));

-- 3. Indexes used by the RLS checks and the app's queries.
create index if not exists projects_owner_id_idx on public.projects (owner_id);
create index if not exists projects_owner_updated_idx on public.projects (owner_id, updated_at desc);
-- files(project_id, path) is already covered by the UNIQUE constraint.

-- 4. Basic size limits so one account can't store unbounded data.
alter table public.projects drop constraint if exists projects_name_len;
alter table public.projects add constraint projects_name_len check (char_length(name) between 1 and 100);
alter table public.files drop constraint if exists files_path_len;
alter table public.files add constraint files_path_len check (char_length(path) between 1 and 512);
alter table public.files drop constraint if exists files_content_size;
alter table public.files add constraint files_content_size check (octet_length(content) <= 2097152); -- 2 MB

-- 5. The anon role never needs these tables.
revoke all on public.user_settings, public.projects, public.files from anon;

commit;
