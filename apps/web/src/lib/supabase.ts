import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://wsmnutkobalfrceavpxs.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzbW51dGtvYmFsZnJjZWF2cHhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwODIxMTcsImV4cCI6MjA4ODY1ODExN30.fqk18_Q81cZMrFyj1ECaJnvcR7G4oerE-RSKFnrAPO4'
)
