import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { success, error, unauthorized } from "@/lib/api/error-response";

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return unauthorized();

    // Check if already connected
    const { data: existing } = await supabase
      .from("telegram_connections")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (existing)
      return error("ALREADY_CONNECTED", "Telegram is already connected", 409);

    // Delete any existing codes for this user
    await supabase
      .from("telegram_auth_codes")
      .delete()
      .eq("user_id", user.id);

    // Generate 6-char alphanumeric code (uppercase, easy to read)
    const code = randomBytes(3).toString("hex").toUpperCase();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: dbError } = await supabase
      .from("telegram_auth_codes")
      .insert({
        user_id: user.id,
        code,
        expires_at: expiresAt,
      });

    if (dbError) return error("DB_ERROR", dbError.message, 500);

    const botUsername =
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "just_ship_bot";
    const deepLink = `https://t.me/${botUsername}?start=${code}`;

    return success({ code, deepLink, expiresAt });
  } catch (err) {
    console.error("Telegram connect crashed:", err);
    return error(
      "INTERNAL_ERROR",
      err instanceof Error ? err.message : "Unknown error",
      500
    );
  }
}
