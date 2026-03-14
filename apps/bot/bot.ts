import { Telegraf, Markup } from "telegraf";
import { getAuthorizedUser } from "./lib/auth.js";
import {
  transcribeVoice,
  describeImage,
  structureTicket,
} from "./lib/ai.js";
import { supabase } from "./lib/supabase.js";
import type { PendingTicket, Project, Workspace, UserState } from "./lib/types.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// In-memory state: workspace state per chat
const userStates = new Map<number, UserState>();

// Pending ticket data per chat (waiting for project selection)
const pendingTickets = new Map<number, PendingTicket>();

// Buffer for media groups (multiple photos sent together)
const mediaGroupBuffers = new Map<
  string,
  {
    chatId: number;
    messageId: number;
    photos: { buffer: Buffer; mimeType: string }[];
    caption: string | null;
    timer: ReturnType<typeof setTimeout>;
  }
>();

async function setReaction(chatId: number, messageId: number, emoji: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (bot.telegram.callApi as any)('setMessageReaction', {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: 'emoji', emoji }],
    });
  } catch (err) {
    console.error('Failed to set reaction:', err);
  }
}

// ---------- Auth middleware ----------
bot.use(async (ctx, next) => {
  if (!ctx.from || !ctx.chat) return;
  const workspaces = await getAuthorizedUser(ctx.from.id);
  if (!workspaces || workspaces.length === 0) {
    await ctx.reply(
      "Du bist nicht mit dem Board verbunden. Verbinde deinen Telegram-Account über das Board.",
    );
    return;
  }
  const existing = userStates.get(ctx.chat.id);
  userStates.set(ctx.chat.id, {
    workspaces,
    activeWorkspaceId:
      existing?.activeWorkspaceId ??
      (workspaces.length === 1 ? workspaces[0].id : null),
  });
  return next();
});

// ---------- /start ----------
bot.start(async (ctx) => {
  await ctx.reply(
    "Willkommen beim Agentic Dev Bot!\n\n" +
      "Sende mir eine Nachricht und ich erstelle ein Ticket daraus:\n" +
      "- Text — einfach losschreiben\n" +
      "- Sprachnachricht — wird transkribiert\n" +
      "- Screenshot(s) — werden analysiert\n" +
      "- Screenshot mit Text — beides wird kombiniert\n\n" +
      "/workspace — Workspace wechseln",
  );
});

// ---------- /workspace ----------
bot.command("workspace", async (ctx) => {
  const state = userStates.get(ctx.chat.id);
  if (!state) return;
  await showWorkspaceSelection(ctx.chat.id, state.workspaces);
});

// ---------- Helper: download file ----------
async function downloadFile(fileId: string): Promise<Buffer> {
  const link = await bot.telegram.getFileLink(fileId);
  const response = await fetch(link.href);
  return Buffer.from(await response.arrayBuffer());
}

// ---------- Helper: show workspace selection ----------
async function showWorkspaceSelection(
  chatId: number,
  workspaces: Workspace[],
): Promise<void> {
  const buttons = workspaces.map((w) =>
    Markup.button.callback(w.name, `workspace:${w.id}`),
  );
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  await bot.telegram.sendMessage(
    chatId,
    "Wähle deinen Workspace:",
    Markup.inlineKeyboard(rows),
  );
}

// ---------- Helper: show project selection ----------
async function showProjectSelection(
  chatId: number,
  projects: Project[],
): Promise<void> {
  if (!projects || projects.length === 0) {
    await bot.telegram.sendMessage(
      chatId,
      "Keine Projekte im aktiven Workspace gefunden.",
    );
    return;
  }

  const buttons = projects.map((p) =>
    Markup.button.callback(p.name, `project:${p.id}`),
  );
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  await bot.telegram.sendMessage(
    chatId,
    "Wähle das Zielprojekt:",
    Markup.inlineKeyboard(rows),
  );
}

// ---------- Helper: route to workspace or project selection ----------
async function handlePendingTicket(
  chatId: number,
  pending: PendingTicket,
): Promise<void> {
  pendingTickets.set(chatId, pending);
  const state = userStates.get(chatId);
  if (!state) return;

  if (!state.activeWorkspaceId) {
    await showWorkspaceSelection(chatId, state.workspaces);
    return;
  }

  const workspace = state.workspaces.find(
    (w) => w.id === state.activeWorkspaceId,
  );
  await showProjectSelection(chatId, workspace?.projects ?? []);
}

// ---------- Text messages ----------
bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;

  await setReaction(ctx.chat.id, ctx.message.message_id, "👀");

  await handlePendingTicket(ctx.chat.id, {
    text: ctx.message.text,
    voice_transcript: null,
    image_descriptions: [],
    raw_caption: null,
    messageId: ctx.message.message_id,
  });
});

// ---------- Voice messages ----------
bot.on("voice", async (ctx) => {
  await setReaction(ctx.chat.id, ctx.message.message_id, "👀");

  try {
    const buffer = await downloadFile(ctx.message.voice.file_id);
    const transcript = await transcribeVoice(buffer);

    await ctx.reply(`Transkription:\n\n${transcript}`);

    await handlePendingTicket(ctx.chat.id, {
      text: null,
      voice_transcript: transcript,
      image_descriptions: [],
      raw_caption: null,
      messageId: ctx.message.message_id,
    });
  } catch (err) {
    console.error("Voice transcription error:", err);
    await ctx.reply("Fehler bei der Transkription. Bitte versuche es erneut.");
  }
});

// ---------- Photo messages ----------
bot.on("photo", async (ctx) => {
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  const caption = ctx.message.caption ?? null;
  const mediaGroupId = ctx.message.media_group_id;

  if (mediaGroupId) {
    const existing = mediaGroupBuffers.get(mediaGroupId);
    if (existing) {
      clearTimeout(existing.timer);
      const buffer = await downloadFile(photo.file_id);
      existing.photos.push({ buffer, mimeType: "image/jpeg" });
      if (caption) existing.caption = caption;
      existing.timer = setTimeout(
        () => processMediaGroup(mediaGroupId),
        1000,
      );
    } else {
      await setReaction(ctx.chat.id, ctx.message.message_id, "👀");
      const buffer = await downloadFile(photo.file_id);
      const timer = setTimeout(
        () => processMediaGroup(mediaGroupId),
        1000,
      );
      mediaGroupBuffers.set(mediaGroupId, {
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        photos: [{ buffer, mimeType: "image/jpeg" }],
        caption,
        timer,
      });
    }
  } else {
    await setReaction(ctx.chat.id, ctx.message.message_id, "👀");

    try {
      const buffer = await downloadFile(photo.file_id);
      const description = await describeImage(buffer, "image/jpeg");

      await handlePendingTicket(ctx.chat.id, {
        text: null,
        voice_transcript: null,
        image_descriptions: [description],
        raw_caption: caption,
        messageId: ctx.message.message_id,
      });
    } catch (err) {
      console.error("Image processing error:", err);
      await ctx.reply(
        "Fehler bei der Bildanalyse. Bitte versuche es erneut.",
      );
    }
  }
});

// ---------- Process media group ----------
async function processMediaGroup(mediaGroupId: string): Promise<void> {
  const group = mediaGroupBuffers.get(mediaGroupId);
  if (!group) return;
  mediaGroupBuffers.delete(mediaGroupId);

  try {
    const descriptions = await Promise.all(
      group.photos.map((p) => describeImage(p.buffer, p.mimeType)),
    );

    await handlePendingTicket(group.chatId, {
      text: null,
      voice_transcript: null,
      image_descriptions: descriptions,
      raw_caption: group.caption,
      messageId: group.messageId,
    });
  } catch (err) {
    console.error("Media group processing error:", err);
    await bot.telegram.sendMessage(
      group.chatId,
      "Fehler bei der Bildanalyse. Bitte versuche es erneut.",
    );
  }
}

// ---------- Workspace selection callback ----------
bot.action(/^workspace:(.+)$/, async (ctx) => {
  const workspaceId = ctx.match[1];
  const chatId = ctx.chat!.id;
  const state = userStates.get(chatId);

  if (!state) {
    await ctx.answerCbQuery();
    return;
  }

  const workspace = state.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) {
    await ctx.answerCbQuery("Workspace nicht gefunden.");
    return;
  }

  state.activeWorkspaceId = workspaceId;
  await ctx.answerCbQuery(`Workspace "${workspace.name}" aktiv`);
  await ctx.editMessageReplyMarkup(undefined);

  const pending = pendingTickets.get(chatId);
  if (pending) {
    await showProjectSelection(chatId, workspace.projects);
  } else {
    await bot.telegram.sendMessage(
      chatId,
      `Workspace "${workspace.name}" aktiv.\n\nSende jetzt eine Nachricht, Sprachnachricht oder Screenshot um ein Ticket zu erstellen.`,
    );
  }
});

// ---------- Project selection callback ----------
bot.action(/^project:(.+)$/, async (ctx) => {
  const projectId = ctx.match[1];
  const chatId = ctx.chat!.id;
  const pending = pendingTickets.get(chatId);
  const state = userStates.get(chatId);

  if (!pending) {
    await ctx.answerCbQuery("Keine ausstehende Nachricht gefunden.");
    return;
  }

  // SECURITY: Validate projectId exists in active workspace
  const activeWorkspace = state?.workspaces.find(
    (w) => w.id === state.activeWorkspaceId,
  );
  const validProject = activeWorkspace?.projects.find(
    (p) => p.id === projectId,
  );

  if (!validProject || !activeWorkspace) {
    await ctx.answerCbQuery("Projekt nicht gefunden oder nicht berechtigt.");
    return;
  }

  pendingTickets.delete(chatId);
  await ctx.answerCbQuery("Erstelle Ticket...");
  await ctx.editMessageReplyMarkup(undefined);

  try {
    const ticket = await structureTicket(pending);

    const { data, error } = await supabase
      .from("tickets")
      .insert({
        title: ticket.title,
        body: ticket.body,
        priority: ticket.priority,
        tags: ticket.tags,
        status: "backlog",
        workspace_id: activeWorkspace.id,
        project_id: projectId,
      })
      .select("number, title")
      .single();

    if (error) throw error;

    await bot.telegram.sendMessage(
      chatId,
      `Ticket T-${data.number} erstellt: ${data.title}\n\nPriority: ${ticket.priority}\nTags: ${ticket.tags.join(", ")}`,
    );
    await setReaction(chatId, pending.messageId, "👍");
  } catch (err) {
    console.error("Ticket creation error:", err);
    await bot.telegram.sendMessage(
      chatId,
      "Fehler beim Erstellen des Tickets. Bitte versuche es erneut.",
    );
  }
});

// ---------- Launch ----------
bot.launch().then(() => {
  console.log("Telegram Bot gestartet");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
