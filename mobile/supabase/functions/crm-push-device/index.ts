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

  let data: { action?: unknown; token?: unknown; platform?: unknown };
  try { data = await req.json(); }
  catch { return reply({ error: "Invalid JSON" }, 400); }
  if (!isPushToken(data.token)) return reply({ error: "Invalid device token" }, 400);
  if (data.action !== "register" && data.action !== "disable") {
    return reply({ error: "Invalid action" }, 400);
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (data.action === "disable") {
    const { error } = await db.from("crm_push_devices").delete()
      .eq("user_id", userId).eq("device_token", data.token);
    if (error) return reply({ error: "Cannot disable device" }, 500);
    return reply({ enabled: false });
  }

  if (data.platform !== "android" && data.platform !== "ios") {
    return reply({ error: "Invalid platform" }, 400);
  }
  // One device token can only belong to the currently signed-in user.
  // This prevents notifications intended for the previous login appearing
  // on a shared phone.
  const { error: clearError } = await db.from("crm_push_devices")
    .delete().eq("device_token", data.token);
  if (clearError) return reply({ error: "Cannot update device registration" }, 500);

  const { error: saveError } = await db.from("crm_push_devices").insert({
    user_id: userId,
    platform: data.platform,
    device_token: data.token,
    active: true,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (saveError) return reply({ error: "Cannot register device" }, 500);
  return reply({ enabled: true, platform: data.platform });
});
