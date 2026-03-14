export interface Project {
  id: string;
  name: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  projects: Project[];
}

export interface UserState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

export interface PendingTicket {
  text: string | null;
  voice_transcript: string | null;
  image_descriptions: string[];
  raw_caption: string | null;
  messageId: number;
}
