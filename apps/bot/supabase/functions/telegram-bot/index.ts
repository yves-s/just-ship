import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ─── Constants ────────────────────────────────────────────────────────────────
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
const BOARD_API_URL = Deno.env.get("BOARD_API_URL")!;
const TELEGRAM_BOT_SECRET = Deno.env.get("TELEGRAM_BOT_SECRET")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Project { id: string; name: string }
interface Workspace { id: string; name: string; slug: string; projects: Project[] }
interface PendingTicket {
  text: string | null;
  voice_transcript: string | null;
  image_descriptions: string[];
  raw_caption: string | null;
}
interface BotState {
  chat_id: number;
  active_workspace_id: string | null;
  pending_data: PendingTicket | null;
}

// ─── Supabase Client ──────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Telegram API Helpers ─────────────────────────────────────────────────────
async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: object,
): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

async function editMessageReplyMarkup(chatId: number, messageId: number): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }),
  });
}

async function downloadFile(fileId: string): Promise<Uint8Array> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
  const data = await res.json();
  const filePath = data.result?.file_path;
  if (!filePath) throw new Error(`Cannot get file path for ${fileId}`);
  const fileRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
  return new Uint8Array(await fileRes.arrayBuffer());
}

function buildInlineKeyboard(items: { label: string; data: string }[]): object {
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(
      items.slice(i, i + 2).map((item) => ({ text: item.label, callback_data: item.data })),
    );
  }
  return { inline_keyboard: rows };
}

// ─── Board API ────────────────────────────────────────────────────────────────
async function getUserWorkspaces(telegramUserId: number): Promise<Workspace[] | null> {
  const url = `${BOARD_API_URL}/api/v1/telegram/workspaces?telegram_user_id=${telegramUserId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TELEGRAM_BOT_SECRET}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Board API error: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.workspaces ?? data.data ?? []);
}

// ─── DB State ─────────────────────────────────────────────────────────────────
async function getState(chatId: number): Promise<BotState> {
  const { data } = await supabase
    .from("telegram_bot_state")
    .select("*")
    .eq("chat_id", chatId)
    .single();
  return data ?? { chat_id: chatId, active_workspace_id: null, pending_data: null };
}

async function setState(chatId: number, updates: Partial<Omit<BotState, "chat_id">>): Promise<void> {
  await supabase.from("telegram_bot_state").upsert({
    chat_id: chatId,
    ...updates,
    updated_at: new Date().toISOString(),
  });
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
async function showWorkspaceSelection(chatId: number, workspaces: Workspace[]): Promise<void> {
  await sendMessage(
    chatId,
    "Wähle deinen Workspace:",
    buildInlineKeyboard(workspaces.map((w) => ({ label: w.name, data: `workspace:${w.id}` }))),
  );
}

async function showProjectSelection(chatId: number, projects: Project[]): Promise<void> {
  if (!projects || projects.length === 0) {
    await sendMessage(chatId, "Keine Projekte im aktiven Workspace gefunden.");
    return;
  }
  await sendMessage(
    chatId,
    "Wähle das Zielprojekt:",
    buildInlineKeyboard(projects.map((p) => ({ label: p.name, data: `project:${p.id}` }))),
  );
}

async function routeToSelection(
  chatId: number,
  pending: PendingTicket,
  workspaces: Workspace[],
  state: BotState,
): Promise<void> {
  await setState(chatId, { pending_data: pending });

  // Auto-select if only one workspace
  if (workspaces.length === 1 && !state.active_workspace_id) {
    await setState(chatId, { active_workspace_id: workspaces[0].id });
    await showProjectSelection(chatId, workspaces[0].projects);
    return;
  }

  if (!state.active_workspace_id) {
    await showWorkspaceSelection(chatId, workspaces);
    return;
  }

  const workspace = workspaces.find((w) => w.id === state.active_workspace_id);
  await showProjectSelection(chatId, workspace?.projects ?? []);
}

// ─── AI Functions ─────────────────────────────────────────────────────────────
async function transcribeVoice(fileData: Uint8Array): Promise<string> {
  const formData = new FormData();
  formData.append("file", new Blob([fileData], { type: "audio/ogg" }), "voice.ogg");
  formData.append("model", "whisper-1");
  formData.append("language", "de");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });
  if (!res.ok) throw new Error(`Whisper error: ${res.status}`);
  const data = await res.json();
  return data.text;
}

function base64Encode(data: Uint8Array): string {
  const chunkSize = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < data.byteLength; i += chunkSize) {
    chunks.push(String.fromCharCode(...data.subarray(i, Math.min(i + chunkSize, data.byteLength))));
  }
  return btoa(chunks.join(""));
}

async function describeImage(imageData: Uint8Array): Promise<string> {
  const base64 = base64Encode(imageData);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
          { type: "text", text: "Beschreibe kurz was auf diesem Screenshot zu sehen ist. Fokus auf UI-Elemente, Fehler, oder relevante Details für ein Bug-/Feature-Ticket. Antworte auf Deutsch, max 3 Sätze." },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

async function structureTicket(
  pending: PendingTicket,
): Promise<{ title: string; body: string; priority: string; tags: string[] }> {
  const parts: string[] = [];
  if (pending.text) parts.push(`Text: ${pending.text}`);
  if (pending.raw_caption) parts.push(`Bildunterschrift: ${pending.raw_caption}`);
  if (pending.voice_transcript) parts.push(`Sprachnachricht (transkribiert): ${pending.voice_transcript}`);
  if (pending.image_descriptions.length > 0) {
    parts.push(`Screenshots:\n${pending.image_descriptions.map((d, i) => `Screenshot ${i + 1}: ${d}`).join("\n")}`);
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: `Du bist ein erfahrener Product Manager. Strukturiere die folgende Nutzereingabe in ein Ticket.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in diesem Format:
{
  "title": "Kurzer, aussagekräftiger Titel",
  "body": "## Problem\\n...\\n\\n## Desired Behavior\\n...\\n\\n## Acceptance Criteria\\n- [ ] ...\\n\\n## Out of Scope\\n- ...",
  "priority": "low|medium|high",
  "tags": ["tag1", "tag2"]
}

Regeln:
- Titel: klar, handlungsorientiert, max 80 Zeichen
- Body: vollständiges Markdown mit Problem, Desired Behavior, Acceptance Criteria, Out of Scope
- Priority: basierend auf Dringlichkeit und Impact
- Tags: 1-3 relevante Tags
- Antworte NUR mit dem JSON-Objekt, kein Markdown-Codeblock`,
      messages: [{ role: "user", content: parts.join("\n\n") }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text ?? "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in AI response");
  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.title || !parsed.body || !parsed.priority || !Array.isArray(parsed.tags)) {
    throw new Error("AI response missing required fields");
  }
  if (!["low", "medium", "high"].includes(parsed.priority)) parsed.priority = "medium";
  return parsed;
}

// ─── Fire-and-Forget Helper ───────────────────────────────────────────────────
function fireAndForget(action: string, body: object): void {
  fetch(`${SUPABASE_URL}/functions/v1/telegram-bot?action=${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  }).catch((err) => console.error(`[${action}] fire-and-forget failed:`, err));
}

// ─── Action Handlers ──────────────────────────────────────────────────────────
async function handleProcessVoice(chatId: number, fileId: string, telegramUserId: number): Promise<void> {
  try {
    const workspaces = await getUserWorkspaces(telegramUserId);
    if (!workspaces) return;
    const state = await getState(chatId);
    if (workspaces.length === 1) state.active_workspace_id = workspaces[0].id;

    const fileData = await downloadFile(fileId);
    const transcript = await transcribeVoice(fileData);
    await sendMessage(chatId, `Transkription:\n\n${transcript}`);

    const pending: PendingTicket = { text: null, voice_transcript: transcript, image_descriptions: [], raw_caption: null };
    await routeToSelection(chatId, pending, workspaces, state);
  } catch (err) {
    console.error("[process_voice] error:", err);
    await sendMessage(chatId, "Fehler bei der Transkription. Bitte versuche es erneut.");
  }
}

async function handleProcessPhoto(
  chatId: number,
  fileId: string,
  caption: string | null,
  telegramUserId: number,
): Promise<void> {
  try {
    const workspaces = await getUserWorkspaces(telegramUserId);
    if (!workspaces) return;
    const state = await getState(chatId);
    if (workspaces.length === 1) state.active_workspace_id = workspaces[0].id;

    const fileData = await downloadFile(fileId);
    const description = await describeImage(fileData);

    const pending: PendingTicket = { text: null, voice_transcript: null, image_descriptions: [description], raw_caption: caption };
    await routeToSelection(chatId, pending, workspaces, state);
  } catch (err) {
    console.error("[process_photo] error:", err);
    await sendMessage(chatId, "Fehler bei der Bildanalyse. Bitte versuche es erneut.");
  }
}

async function handleProcessMediaGroup(mediaGroupId: string, chatId: number, telegramUserId: number): Promise<void> {
  try {
    // Wait for all photos to arrive
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Atomically claim this media group
    const { data: claimed } = await supabase
      .from("telegram_media_group_buffer")
      .update({ processed: true })
      .eq("media_group_id", mediaGroupId)
      .eq("processed", false)
      .select("file_ids, caption")
      .single();

    if (!claimed) return; // Another invocation already processed this group

    const workspaces = await getUserWorkspaces(telegramUserId);
    if (!workspaces) return;
    const state = await getState(chatId);
    if (workspaces.length === 1) state.active_workspace_id = workspaces[0].id;

    const descriptions = await Promise.all(
      (claimed.file_ids as string[]).map(async (fileId) => {
        const fileData = await downloadFile(fileId);
        return describeImage(fileData);
      }),
    );

    const pending: PendingTicket = {
      text: null,
      voice_transcript: null,
      image_descriptions: descriptions,
      raw_caption: claimed.caption ?? null,
    };
    await routeToSelection(chatId, pending, workspaces, state);
  } catch (err) {
    console.error("[process_media_group] error:", err);
    await sendMessage(chatId, "Fehler bei der Bildanalyse. Bitte versuche es erneut.");
  }
}

async function handleCreateTicket(chatId: number, projectId: string, workspaceId: string): Promise<void> {
  try {
    const state = await getState(chatId);
    const pending = state.pending_data;
    if (!pending) return;

    await setState(chatId, { pending_data: null });

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

    await sendMessage(
      chatId,
      `✅ Ticket T-${data.number} erstellt: <b>${data.title}</b>\n\nPriority: ${ticket.priority}\nTags: ${ticket.tags.join(", ")}`,
    );
  } catch (err) {
    console.error("[create_ticket] error:", err);
    await sendMessage(chatId, "Fehler beim Erstellen des Tickets. Bitte versuche es erneut.");
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // --- Admin / async actions (require service-role key) ---
  if (action) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (action === "set-webhook") {
      const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-bot`;
      const params: Record<string, unknown> = {
        url: webhookUrl,
        allowed_updates: ["message", "callback_query"],
        max_connections: 100,
      };
      if (WEBHOOK_SECRET) params.secret_token = WEBHOOK_SECRET;
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const result = await res.json();
      return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    if (action === "webhook-info") {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
      const result = await res.json();
      return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    if (action === "process_voice") {
      const { chat_id, file_id, telegram_user_id } = await req.json();
      await handleProcessVoice(chat_id, file_id, telegram_user_id);
      return new Response("ok");
    }

    if (action === "process_photo") {
      const { chat_id, file_id, caption, telegram_user_id } = await req.json();
      await handleProcessPhoto(chat_id, file_id, caption ?? null, telegram_user_id);
      return new Response("ok");
    }

    if (action === "process_media_group") {
      const { media_group_id, chat_id, telegram_user_id } = await req.json();
      await handleProcessMediaGroup(media_group_id, chat_id, telegram_user_id);
      return new Response("ok");
    }

    if (action === "create_ticket") {
      const { chat_id, project_id, workspace_id } = await req.json();
      await handleCreateTicket(chat_id, project_id, workspace_id);
      return new Response("ok");
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
  }

  // --- Webhook from Telegram ---
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (WEBHOOK_SECRET && req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update = await req.json();

  // --- callback_query (inline keyboard selection) ---
  if (update.callback_query) {
    const cbq = update.callback_query;
    const chatId: number = cbq.message.chat.id;
    const messageId: number = cbq.message.message_id;
    const data: string = cbq.data;
    const telegramUserId: number = cbq.from.id;

    if (data.startsWith("workspace:")) {
      const workspaceId = data.slice("workspace:".length);
      const workspaces = await getUserWorkspaces(telegramUserId);
      if (!workspaces) {
        await answerCallbackQuery(cbq.id, "Nicht autorisiert.");
        return new Response("ok");
      }
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (!workspace) {
        await answerCallbackQuery(cbq.id, "Workspace nicht gefunden.");
        return new Response("ok");
      }

      await setState(chatId, { active_workspace_id: workspaceId });
      await answerCallbackQuery(cbq.id, `Workspace "${workspace.name}" aktiv`);
      await editMessageReplyMarkup(chatId, messageId);

      const state = await getState(chatId);
      if (state.pending_data) {
        await showProjectSelection(chatId, workspace.projects);
      } else {
        await sendMessage(chatId, `Workspace <b>${workspace.name}</b> aktiv.\n\nSende eine Nachricht, Sprachnachricht oder Screenshot.`);
      }
      return new Response("ok");
    }

    if (data.startsWith("project:")) {
      const projectId = data.slice("project:".length);
      const workspaces = await getUserWorkspaces(telegramUserId);
      if (!workspaces) {
        await answerCallbackQuery(cbq.id, "Nicht autorisiert.");
        return new Response("ok");
      }
      const state = await getState(chatId);
      // SECURITY: validate projectId is in active workspace
      const activeWorkspace = workspaces.find((w) => w.id === state.active_workspace_id);
      const validProject = activeWorkspace?.projects.find((p) => p.id === projectId);
      if (!validProject || !activeWorkspace) {
        await answerCallbackQuery(cbq.id, "Projekt nicht gefunden oder nicht berechtigt.");
        return new Response("ok");
      }
      if (!state.pending_data) {
        await answerCallbackQuery(cbq.id, "Keine ausstehende Nachricht gefunden.");
        return new Response("ok");
      }

      await answerCallbackQuery(cbq.id, "Erstelle Ticket...");
      await editMessageReplyMarkup(chatId, messageId);

      fireAndForget("create_ticket", {
        chat_id: chatId,
        project_id: projectId,
        workspace_id: activeWorkspace.id,
      });
      return new Response("ok");
    }

    await answerCallbackQuery(cbq.id);
    return new Response("ok");
  }

  // --- message ---
  if (!update.message) return new Response("ok");

  const msg = update.message;
  const chatId: number = msg.chat.id;
  const telegramUserId: number = msg.from?.id;

  if (!telegramUserId) return new Response("ok");

  // Plain 6-char hex code or /start {code} — verify connection BEFORE auth check
  const rawText = msg.text?.trim() ?? "";
  const maybeCode = rawText.startsWith("/start ") ? rawText.slice("/start ".length).trim() : rawText;
  if (/^[0-9A-Fa-f]{6}$/.test(maybeCode)) {
    const verifyRes = await fetch(`${BOARD_API_URL}/api/v1/telegram/verify`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${TELEGRAM_BOT_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ code: maybeCode.toUpperCase(), telegram_user_id: telegramUserId, telegram_username: msg.from?.username ?? null }),
    });
    if (verifyRes.ok) {
      await sendMessage(chatId, "✅ Verbunden! Sende eine Nachricht, Sprachnachricht oder Screenshot, um ein Ticket zu erstellen.");
    } else if (verifyRes.status === 409) {
      await sendMessage(chatId, "⚠️ Dieser Telegram-Account ist bereits verbunden.");
    } else {
      await sendMessage(chatId, "❌ Code ungültig oder abgelaufen. Generiere einen neuen Code im Board.");
    }
    return new Response("ok");
  }

  // Auth check
  const workspaces = await getUserWorkspaces(telegramUserId);
  if (!workspaces || workspaces.length === 0) {
    await sendMessage(
      chatId,
      "👋 Willkommen! Verbinde zuerst deinen Telegram-Account:\n\n" +
      `1. Öffne <a href="${BOARD_API_URL}">app.just-ship.io</a>\n` +
      "2. Klicke in der Sidebar auf das Telegram-Symbol\n" +
      `3. Klicke auf <b>"Code generieren"</b>\n` +
      "4. Schick mir den 6-stelligen Code\n\n" +
      "Beispiel: <code>7BC334</code>",
    );
    return new Response("ok");
  }

  const state = await getState(chatId);
  // Auto-set workspace if only one
  if (!state.active_workspace_id && workspaces.length === 1) {
    state.active_workspace_id = workspaces[0].id;
    await setState(chatId, { active_workspace_id: workspaces[0].id });
  }

  // /start command
  if (msg.text === "/start") {
    await sendMessage(
      chatId,
      "Willkommen beim Just Ship Bot!\n\n" +
        "Sende mir eine Nachricht und ich erstelle ein Ticket daraus:\n" +
        "- Text — einfach losschreiben\n" +
        "- Sprachnachricht — wird transkribiert\n" +
        "- Screenshot(s) — werden analysiert\n" +
        "- Screenshot mit Text — beides wird kombiniert\n\n" +
        "/workspace — Workspace wechseln",
    );
    return new Response("ok");
  }

  // /workspace command
  if (msg.text === "/workspace") {
    await showWorkspaceSelection(chatId, workspaces);
    return new Response("ok");
  }

  // Text message
  if (msg.text && !msg.text.startsWith("/")) {
    await sendMessage(chatId, "Verarbeite Nachricht...");
    const pending: PendingTicket = { text: msg.text, voice_transcript: null, image_descriptions: [], raw_caption: null };
    await routeToSelection(chatId, pending, workspaces, state);
    return new Response("ok");
  }

  // Voice message
  if (msg.voice) {
    await sendMessage(chatId, "Transkribiere Sprachnachricht...");
    fireAndForget("process_voice", {
      chat_id: chatId,
      file_id: msg.voice.file_id,
      telegram_user_id: telegramUserId,
    });
    return new Response("ok");
  }

  // Photo message
  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    const caption = msg.caption ?? null;
    const mediaGroupId = msg.media_group_id;

    if (mediaGroupId) {
      // Buffer photo in DB
      const { data: existing } = await supabase
        .from("telegram_media_group_buffer")
        .select("file_ids")
        .eq("media_group_id", mediaGroupId)
        .single();

      if (existing) {
        // Add to existing group
        await supabase
          .from("telegram_media_group_buffer")
          .update({ file_ids: [...(existing.file_ids as string[]), photo.file_id] })
          .eq("media_group_id", mediaGroupId);
      } else {
        // First photo in group — create buffer entry and send status message
        await supabase.from("telegram_media_group_buffer").insert({
          media_group_id: mediaGroupId,
          chat_id: chatId,
          file_ids: [photo.file_id],
          caption,
        });
        await sendMessage(chatId, "Analysiere Screenshot(s)...");
        fireAndForget("process_media_group", {
          media_group_id: mediaGroupId,
          chat_id: chatId,
          telegram_user_id: telegramUserId,
        });
      }
    } else {
      // Single photo
      await sendMessage(chatId, "Analysiere Screenshot...");
      fireAndForget("process_photo", {
        chat_id: chatId,
        file_id: photo.file_id,
        caption,
        telegram_user_id: telegramUserId,
      });
    }
    return new Response("ok");
  }

  return new Response("ok");
});
