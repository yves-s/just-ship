-- Migration: Add total_tokens column to tickets for accumulated token usage tracking

ALTER TABLE public.tickets ADD COLUMN total_tokens BIGINT DEFAULT 0;

-- Function for atomic token increment (called from events API)
CREATE OR REPLACE FUNCTION public.increment_ticket_tokens(ticket_id_param UUID, tokens_param BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE public.tickets
  SET total_tokens = COALESCE(total_tokens, 0) + tokens_param
  WHERE id = ticket_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
