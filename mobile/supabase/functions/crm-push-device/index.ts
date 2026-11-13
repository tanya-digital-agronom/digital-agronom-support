import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

function env(name: string): string {
  return Deno.env.get(name) || "";
}
function isPushToken(token: unknown): token is string {
  return typeof token === "string" && token.length >= 20 &&
    token.length <= 4096 && !/[\s\u0000-\u001f]/.test(token);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const bearer = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return reply({ error: "Not authenticated" }, 401);

  const url = env("SUPABASE_URL");
  const anonKey = env("SUPABASE_ANON_KEY");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return reply({ error: "Server is not configured" }, 503);

  const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(bearer);
  if (authError || !authData?.user || authData.user.is_anonymous) {
    return reply({ error: "Invalid session" }, 401);
  }
  const userId = authData.user.id;

  let data: { action?: unknown; token?: unknown; platform?: unknown; installation_id?: unknown };
  try { data = await req.json(); }
  catch { return reply({ error: "Invalid JSON" }, 400); }
  if (data.action !== "register" && data.action !== "disable") {
    return reply({ error: "Invalid action" }, 400);
  }
  if (typeof data.installation_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.installation_id)) {
    return reply({ error: "Invalid installation identifier" }, 400);
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (data.action === "disable") {
    const { error } = await db.from("crm_push_devices").delete()
      .eq("user_id", userId).eq("installation_id", data.installation_id);
    if (error) return reply({ error: "Cannot disable device" }, 500);
    return reply({ enabled: false });
  }

  if (!isPushToken(data.token)) return reply({ error: "Invalid device token" }, 400);
  if (data.platform !== "android" && data.platform !== "ios") {
    return reply({ error: "Invalid platform" }, 400);
  }
  const { data: existing, error: lookupError } = await db.from("crm_push_devices")
    .select("id,user_id").eq("installation_id", data.installation_id).maybeSingle();
  if (lookupError) return reply({ error: "Cannot check installation" }, 500);
  if (existing && existing.user_id !== userId) {
    const { error: clearError } = await db.from("crm_push_devices")
      .delete().eq("id", existing.id);
    if (clearError) return reply({ error: "Cannot transfer installation" }, 500);
  }
  // Tokens rotate. Remove an old registration for this exact token on
  // another installation, while preserving this installation's dedup history.
  const { error: tokenError } = await db.from("crm_push_devices")
    .delete().eq("device_token", data.token).neq("installation_id", data.installation_id);
  if (tokenError) return reply({ error: "Cannot rotate device token" }, 500);
  const { error: saveError } = await db.from("crm_push_devices").upsert({
    installation_id: data.installation_id,
    user_id: userId,
    platform: data.platform,
    device_token: data.token,
    active: true,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "installation_id" });
  if (saveError) return reply({ error: "Cannot register device" }, 500);
  return reply({ enabled: true, platform: data.platform });
});
