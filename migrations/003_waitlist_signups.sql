-- 003_waitlist_signups.sql
-- Create waitlist_signups table for marketing landing page signups

-- =============================================================================
-- Waitlist Signups
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.waitlist_signups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_waitlist_signups_email ON public.waitlist_signups(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_signups_created_at ON public.waitlist_signups(created_at);

-- =============================================================================
-- Row Level Security
-- =============================================================================

-- Enable RLS on waitlist_signups table
ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to INSERT only
CREATE POLICY "waitlist_insert_anon" ON public.waitlist_signups
  FOR INSERT
  WITH CHECK (true)
  TO anon;

-- Allow authenticated users to SELECT (for team members to view the list)
CREATE POLICY "waitlist_select_authenticated" ON public.waitlist_signups
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- =============================================================================
-- Updated_at Trigger
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_waitlist_signups'
  ) THEN
    CREATE TRIGGER set_updated_at_waitlist_signups
      BEFORE UPDATE ON public.waitlist_signups
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;
