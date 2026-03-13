import { Telegraf, Markup } from "telegraf";
import { getAuthorizedUser } from "./lib/auth.js";
import {
  transcribeVoice,
  describeImage,
  structureTicket,
} from "./lib/ai.js";
import { supabase } from "./lib/supabase.js";
import type { PendingTicket, Project } from "./lib/types.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const workspaceId = process.env.WORKSPACE_ID!;

// Pending ticket data per chat (waiting for project selection)
const pendingTickets = new Map<number, PendingTicket>();

// Buffer for media groups (multiple photos sent together)
const mediaGroupBuffers = new Map<
  string,
  {
    chatId: number;
    photos: { buffer: Buffer; mimeType: string }[];
    caption: string | null;
    timer: ReturnType<typeof setTimeout>;
  }
>();

// ---------- Auth middleware ----------
bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  const user = await getAuthorizedUser(ctx.from.id);
  if (!user) {
    await ctx.reply(
      "Du bist nicht für diesen Bot registriert. Bitte kontaktiere einen Admin.",
    );
    return;
  }
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
      "- Screenshot mit Text — beides wird kombiniert",
  );
});

// ---------- Helper: download file ----------
async function downloadFile(fileId: string): Promise<Buffer> {
  const link = await bot.telegram.getFileLink(fileId);
  const response = await fetch(link.href);
  return Buffer.from(await response.arrayBuffer());
}

// ---------- Helper: show project selection ----------
async function showProjectSelection(
  chatId: number,
  pending: PendingTicket,
): Promise<void> {
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .order("name");

  if (!projects || projects.length === 0) {
    await bot.telegram.sendMessage(chatId, "Keine Projekte gefunden.");
    return;
  }

  pendingTickets.set(chatId, pending);

  const buttons = (projects as Project[]).map((p) =>
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

// ---------- Text messages ----------
bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;

  await ctx.reply("Verarbeite Nachricht...");

  await showProjectSelection(ctx.chat.id, {
    text: ctx.message.text,
    voice_transcript: null,
    image_descriptions: [],
    raw_caption: null,
  });
});

// ---------- Voice messages ----------
bot.on("voice", async (ctx) => {
  await ctx.reply("Transkribiere Sprachnachricht...");

  try {
    const buffer = await downloadFile(ctx.message.voice.file_id);
    const transcript = await transcribeVoice(buffer);

    await ctx.reply(`Transkription:\n\n${transcript}`);

    await showProjectSelection(ctx.chat.id, {
      text: null,
      voice_transcript: transcript,
      image_descriptions: [],
      raw_caption: null,
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
      const buffer = await downloadFile(photo.file_id);
      const timer = setTimeout(
        () => processMediaGroup(mediaGroupId),
        1000,
      );
      mediaGroupBuffers.set(mediaGroupId, {
        chatId: ctx.chat.id,
        photos: [{ buffer, mimeType: "image/jpeg" }],
        caption,
        timer,
      });
      await ctx.reply("Analysiere Screenshot(s)...");
    }
  } else {
    await ctx.reply("Analysiere Screenshot...");

    try {
      const buffer = await downloadFile(photo.file_id);
      const description = await describeImage(buffer, "image/jpeg");

      await showProjectSelection(ctx.chat.id, {
        text: null,
        voice_transcript: null,
        image_descriptions: [description],
        raw_caption: caption,
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

    await showProjectSelection(group.chatId, {
      text: null,
      voice_transcript: null,
      image_descriptions: descriptions,
      raw_caption: group.caption,
    });
  } catch (err) {
    console.error("Media group processing error:", err);
    await bot.telegram.sendMessage(
      group.chatId,
      "Fehler bei der Bildanalyse. Bitte versuche es erneut.",
    );
  }
}

// ---------- Project selection callback ----------
bot.action(/^project:(.+)$/, async (ctx) => {
  const projectId = ctx.match[1];
  const chatId = ctx.chat!.id;
  const pending = pendingTickets.get(chatId);

  if (!pending) {
    await ctx.answerCbQuery("Keine ausstehende Nachricht gefunden.");
    return;
  }

  pendingTickets.delete(chatId);
  await ctx.answerCbQuery("Erstelle Ticket...");
  await ctx.editMessageReplyMarkup(undefined);

  try {
    // SECURITY: Validate projectId exists in workspace
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      .single();

    if (projectError || !project) {
      await bot.telegram.sendMessage(
        chatId,
        "Projekt nicht gefunden oder nicht berechtigt.",
      );
      return;
    }

    const ticket = await structureTicket(pending);

    const { data, error } = await supabase
      .from("tickets")
      .insert({
        title: ticket.title,
        body: ticket.body,
        priority: ticket.priority,
        tags: ticket.tags,
        status: "backlog",
        workspace_id: workspaceId,
        project_id: projectId,
      })
      .select("number, title")
      .single();

    if (error) throw error;

    await bot.telegram.sendMessage(
      chatId,
      `Ticket T-${data.number} erstellt: ${data.title}\n\nPriority: ${ticket.priority}\nTags: ${ticket.tags.join(", ")}`,
    );
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
