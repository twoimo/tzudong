-- Allow the review OCR API to persist per-user quota/cache logs when it runs
-- with the caller's authenticated JWT instead of a service role key.
-- The API still validates the user server-side before inserting.

drop policy if exists "Users can insert their own OCR logs" on public.ocr_logs;

create policy "Users can insert their own OCR logs"
  on public.ocr_logs for insert
  to authenticated
  with check (auth.uid() = user_id);
