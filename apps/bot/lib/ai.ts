import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { PendingTicket } from "./types.js";

const anthropic = new Anthropic();
const openai = new OpenAI();

export async function transcribeVoice(buffer: Buffer): Promise<string> {
  const uint8 = new Uint8Array(buffer);
  const file = new File([uint8], "voice.ogg", { type: "audio/ogg" });
  const response = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    language: "de",
  });
  return response.text;
}

export async function describeImage(
  imageBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  const base64 = imageBuffer.toString("base64");
  const mediaType = mimeType as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: "Beschreibe kurz was auf diesem Screenshot zu sehen ist. Fokus auf UI-Elemente, Fehler, oder relevante Details für ein Bug-/Feature-Ticket. Antworte auf Deutsch, max 3 Sätze.",
          },
        ],
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

export async function structureTicket(
  input: PendingTicket,
): Promise<{ title: string; body: string; priority: string; tags: string[] }> {
  const parts: string[] = [];

  if (input.text) parts.push(`Text: ${input.text}`);
  if (input.raw_caption) parts.push(`Bildunterschrift: ${input.raw_caption}`);
  if (input.voice_transcript)
    parts.push(
      `Sprachnachricht (transkribiert): ${input.voice_transcript}`,
    );
  if (input.image_descriptions.length > 0) {
    parts.push(
      `Screenshots:\n${input.image_descriptions.map((d, i) => `Screenshot ${i + 1}: ${d}`).join("\n")}`,
    );
  }

  const userInput = parts.join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages: [{ role: "user", content: userInput }],
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
- Beschreibe das WAS und WARUM, nicht das WIE
- Acceptance Criteria müssen testbar sein
- Antworte NUR mit dem JSON-Objekt, kein Markdown-Codeblock`,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "{}";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI response did not contain valid JSON");

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    // SECURITY: Validate required fields exist
    if (!parsed.title || !parsed.body || !parsed.priority || !Array.isArray(parsed.tags)) {
      throw new Error("AI response missing required fields");
    }
    // Validate priority is allowed value
    if (!["low", "medium", "high"].includes(parsed.priority)) {
      parsed.priority = "medium";
    }
    return parsed;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error("AI response contained invalid JSON: " + e.message);
    }
    throw e;
  }
}
