-- NexIDE schema — run in your Supabase SQL Editor for a fresh project.
-- Existing projects: run supabase/migrations/001_hardening.sql instead.

-- 1. User Settings (non-secret preferences only; API keys stay in the browser)
CREATE TABLE IF NOT EXISTS public.user_settings (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Projects
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CONSTRAINT projects_name_len CHECK (char_length(name) BETWEEN 1 AND 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner_id_idx ON public.projects (owner_id);
CREATE INDEX IF NOT EXISTS projects_owner_updated_idx ON public.projects (owner_id, updated_at DESC);

-- 3. Files (virtual file system)
CREATE TABLE IF NOT EXISTS public.files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL CONSTRAINT files_path_len CHECK (char_length(path) BETWEEN 1 AND 512),
    name TEXT NOT NULL,
    content TEXT DEFAULT '' CONSTRAINT files_content_size CHECK (octet_length(content) <= 2097152),
    language TEXT DEFAULT 'plaintext',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(project_id, path)
);

-- 4. Row Level Security
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_settings, public.projects, public.files FROM anon;

-- 5. Policies ((select auth.uid()) is evaluated once per query, not per row)
CREATE POLICY "Users can manage their own settings" ON public.user_settings
    FOR ALL TO authenticated
    USING ((select auth.uid()) = id)
    WITH CHECK ((select auth.uid()) = id);

CREATE POLICY "Users can manage their own projects" ON public.projects
    FOR ALL TO authenticated
    USING ((select auth.uid()) = owner_id)
    WITH CHECK ((select auth.uid()) = owner_id);

CREATE POLICY "Users can manage files in their projects" ON public.files
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = files.project_id AND p.owner_id = (select auth.uid())
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = files.project_id AND p.owner_id = (select auth.uid())
    ));
