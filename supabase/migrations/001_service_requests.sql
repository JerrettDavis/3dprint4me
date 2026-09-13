-- Run in the Supabase SQL editor or through the Supabase CLI.
create table if not exists public.service_requests (
  id text primary key,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'quoted', 'approved', 'in_progress', 'completed', 'declined', 'cancelled')),
  service text not null check (service in ('print', 'design', 'repair', 'consult')),
  project_title text not null,
  contact_name text not null,
  contact_email text not null,
  payload jsonb not null default '{}'::jsonb,
  uploaded_files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists service_requests_created_at_idx on public.service_requests (created_at desc);
create index if not exists service_requests_status_idx on public.service_requests (status, created_at desc);
create index if not exists service_requests_email_idx on public.service_requests (lower(contact_email));

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists service_requests_set_updated_at on public.service_requests;
create trigger service_requests_set_updated_at before update on public.service_requests for each row execute function public.set_updated_at();

alter table public.service_requests enable row level security;
-- Deliberately no anon/authenticated policies. The Vercel functions use the
-- server-only service-role key, which bypasses RLS. Never ship that key to the browser.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'service-files',
  'service-files',
  false,
  26214400,
  array['application/octet-stream','application/zip','application/x-zip-compressed','application/pdf','text/plain','image/jpeg','image/png','image/webp','model/stl','application/vnd.ms-pki.stl','model/3mf','application/vnd.ms-package.3dmanufacturing-3dmodel+xml','model/obj','model/step','application/step','application/x-step']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Signed upload and download URLs are created by the service-role functions.
-- No public storage.objects policies are required or desired.
