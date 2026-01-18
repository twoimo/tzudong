-- Enable RLS on ocr_logs table
ALTER TABLE "public"."ocr_logs" ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can INSERT their own logs
CREATE POLICY "Users can insert their own ocr logs"
ON "public"."ocr_logs"
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Policy: Authenticated users can SELECT their own logs
CREATE POLICY "Users can view their own ocr logs"
ON "public"."ocr_logs"
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Optional: Allow Service Role to do everything (usually automatic, but explicitly good)
-- Service Role bypasses RLS by default, so explicit policy is not strictly required but good for documentation.
