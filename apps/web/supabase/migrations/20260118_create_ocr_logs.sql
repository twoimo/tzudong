-- Create a table to track OCR usage logs
create table if not exists public.ocr_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  image_hash text not null,
  model_used text default 'gemini-3-flash-preview',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  success boolean default true,
  metadata jsonb
);

-- Index for querying daily usage quota by user
create index if not exists idx_ocr_logs_user_date on public.ocr_logs(user_id, created_at desc);

-- Index for checking duplicate image processing (optional future use)
create index if not exists idx_ocr_logs_hash on public.ocr_logs(image_hash);

-- RLS policies (optional, but good practice if exposed to client)
alter table public.ocr_logs enable row level security;

-- Allow users to view their own logs (if needed in UI)
create policy "Users can view their own OCR logs"
  on public.ocr_logs for select
  using (auth.uid() = user_id);

-- Only service role can insert (handled by API route)
-- or allow authenticated users to insert if called from client (not the case here, API handles it)
