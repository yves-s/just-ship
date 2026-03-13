export interface TelegramUser {
  id: string;
  telegram_user_id: number;
  workspace_id: string;
  telegram_username: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
}

export interface PendingTicket {
  text: string | null;
  voice_transcript: string | null;
  image_descriptions: string[];
  raw_caption: string | null;
}
