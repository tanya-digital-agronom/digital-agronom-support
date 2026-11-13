import { createClient } from "npm:@supabase/supabase-js@2.119.0";

type Platform = "android" | "ios";
type PushDevice = { id: string; user_id: string; device_token: string; platform: Platform };
type Alert = { user_id: string; kind: "task" | "case"; source_id: string; title: string; body: string };
type ServiceAccount = { project_id: string; client_email: string; private_key: string };
const env = (key: string) => Deno.env.get(key) || "";
const headers = { "Content-Type": "application/json; charset=utf-8" };
const answer = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let value = "";
  for (let i = 0; i < bytes.length; i++) value += String.fromCharCode(bytes[i]);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function privateKeyBytes(pem: string): Uint8Array {
  const base64 = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
  return Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
}
async function makeJwt(
  header: Record<string, string>,
  payload: Record<string, unknown>,
  keyPem: string,
  algorithm: "RS256" | "ES256",
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8", privateKeyBytes(keyPem),
    algorithm === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
      : { name: "ECDSA", namedCurve: "P-256" },
    false, ["sign"],
  );
  const part = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    algorithm === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5" }
      : { name: "ECDSA", hash: "SHA-256" },
    key, new TextEncoder().encode(part),
  );
  return part + "." + base64url(new Uint8Array(signature));
}

let cachedGoogleToken: { token: string; expires: number } | null = null;
async function googleToken(account: ServiceAccount): Promise<string> {
  if (cachedGoogleToken && Date.now() < cachedGoogleToken.expires) return cachedGoogleToken.token;
  const now = Math.floor(Date.now() / 1000);
  const jwt = await makeJwt({ alg: "RS256", typ: "JWT" }, {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }, account.private_key, "RS256");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error("FCM authentication failed: " + response.status);
  cachedGoogleToken = {
    token: body.access_token,
    expires: Date.now() + Math.min(3300, (body.expires_in || 3600) - 120) * 1000,
  };
  return cachedGoogleToken.token;
}

let cachedAppleToken: { token: string; expires: number } | null = null;
async function appleToken(): Promise<string> {
  if (cachedAppleToken && Date.now() < cachedAppleToken.expires) return cachedAppleToken.token;
  const now = Math.floor(Date.now() / 1000);
  const token = await makeJwt(
    { alg: "ES256", kid: env("APNS_KEY_ID"), typ: "JWT" },
    { iss: env("APNS_TEAM_ID"), iat: now },
    env("APNS_PRIVATE_KEY"), "ES256",
  );
  cachedAppleToken = { token, expires: Date.now() + 50 * 60 * 1000 };
  return token;
}

async function deliver(device: PushDevice, alert: Alert, firebaseAccount: ServiceAccount | null):
  Promise<{ ok: boolean; expired: boolean; code: string }> {
  if (device.platform === "android") {
    if (!firebaseAccount) return { ok: false, expired: false, code: "fcm_not_configured" };
    const oauth = await googleToken(firebaseAccount);
    const response = await fetch(
      "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(firebaseAccount.project_id) + "/messages:send",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + oauth, "Content-Type": "application/json" },
        body: JSON.stringify({ message: {
          token: device.device_token,
          notification: { title: alert.title, body: alert.body },
          data: { kind: alert.kind, id: alert.source_id },
          android: { priority: "high", notification: { channel_id: "crm_overdue" } },
        } }),
      },
    );
    const content = await response.json().catch(() => ({}));
    const code = content?.error?.details?.[0]?.errorCode || content?.error?.status || String(response.status);
    return {
      ok: response.ok,
      expired: code === "UNREGISTERED" || code === "SENDER_ID_MISMATCH",
      code: response.ok ? "sent" : String(code).slice(0, 140),
    };
  }
  if (!env("APNS_PRIVATE_KEY") || !env("APNS_TEAM_ID") || !env("APNS_KEY_ID") || !env("APNS_BUNDLE_ID")) {
    return { ok: false, expired: false, code: "apns_not_configured" };
  }
  const endpoint = env("APNS_ENVIRONMENT") === "production" ?
    "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  const response = await fetch(endpoint + "/3/device/" + encodeURIComponent(device.device_token), {
    method: "POST",
    headers: {
      authorization: "bearer " + await appleToken(),
      "apns-topic": env("APNS_BUNDLE_ID"),
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: { alert: { title: alert.title, body: alert.body }, sound: "default" },
      kind: alert.kind, id: alert.source_id,
    }),
  });
  const content = response.ok ? {} : await response.json().catch(() => ({}));
  const code = content?.reason || String(response.status);
  return { ok: response.ok, expired: response.status === 410, code: response.ok ? "sent" : String(code).slice(0, 140) };
}
function localDay(): string {
  // Same work-calendar date used by the team (Moscow).
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function dateMinusDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}
function uniqueAlerts(rows: Alert[]): Alert[] {
  const seen = new Set<string>();
  return rows.filter(a => {
    const key = a.user_id + ":" + a.kind + ":" + a.source_id;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function unauthorized(req: Request): boolean {
  const secret = env("CRM_PUSH_CRON_SECRET");
  const input = req.headers.get("x-crm-push-secret") || "";
  if (secret.length < 32 || input.length !== secret.length) return true;
  let mismatch = 0;
  for (let i = 0; i < secret.length; i++) mismatch |= secret.charCodeAt(i) ^ input.charCodeAt(i);
  return mismatch !== 0;
}
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return answer({ error: "Method not allowed" }, 405);
  // This endpoint is NOT public and cannot be called with a user's JWT or anon key.
  if (!env("CRM_PUSH_CRON_SECRET")) return answer({ error: "Push schedule is not configured" }, 503);
  if (unauthorized(req)) return answer({ error: "Unauthorized" }, 401);
  const url = env("SUPABASE_URL"), serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return answer({ error: "Server missing Supabase credentials" }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let firebaseAccount: ServiceAccount | null = null;
  try {
    const raw = env("FCM_SERVICE_ACCOUNT_JSON");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.client_email || !parsed.project_id || !parsed.private_key) throw new Error("Invalid FCM key");
      firebaseAccount = parsed;
    }
  } catch { return answer({ error: "Invalid FCM configuration" }, 503); }
  const hasApple = ["APNS_PRIVATE_KEY","APNS_TEAM_ID","APNS_KEY_ID","APNS_BUNDLE_ID"].every(k => !!env(k));
  if (!firebaseAccount && !hasApple) {
    return answer({ error: "Configure Firebase or Apple push credentials before scheduling" }, 503);
  }
  const today = localDay(), threshold = dateMinusDays(today, 3);
  const { data: admins, error: roleError } = await db.from("profiles").select("id").eq("role", "admin");
  if (roleError) return answer({ error: "Cannot load administrators" }, 500);
  const adminIds = (admins || []).map((a: { id: string }) => a.id);

  const [{ data: tasks, error: taskError }, { data: cases, error: caseError }] = await Promise.all([
    db.from("team_tasks").select("id,assignee_id,title,status,due_date")
      .lt("due_date", today).neq("status", "Выполнено").limit(1000),
    db.from("cases").select("id,owner_id,tk,status,incident_date")
      .lt("incident_date", threshold).neq("status", "Решено").limit(1000),
  ]);
  if (taskError || caseError) return answer({ error: "Cannot retrieve overdue items" }, 500);

  const alerts: Alert[] = [];
  for (const t of tasks || []) {
    for (const user_id of new Set([...adminIds, t.assignee_id].filter(Boolean))) {
      alerts.push({
        user_id, kind: "task", source_id: t.id,
        title: "Просрочена задача",
        body: "Срок выполнения задачи истёк. Откройте «Цифровой Агроном».",
      });
    }
  }
  for (const c of cases || []) {
    for (const user_id of new Set([...adminIds, c.owner_id].filter(Boolean))) {
      alerts.push({
        user_id, kind: "case", source_id: c.id,
        title: "Просрочено обращение",
        body: "Обращение остаётся нерешённым более трёх дней. Откройте CRM.",
      });
    }
  }
  const unique = uniqueAlerts(alerts);
  const activeUsers = [...new Set(unique.map(x => x.user_id))];
  if (!activeUsers.length) return answer({ checked: 0, sent: 0, skipped: 0, failed: 0 });
  const { data: devices, error: deviceError } = await db.from("crm_push_devices")
    .select("id,user_id,device_token,platform").eq("active", true)
    .in("user_id", activeUsers).limit(5000);
  if (deviceError) return answer({ error: "Cannot retrieve push devices" }, 500);
  const byUser = new Map<string, PushDevice[]>();
  for (const device of (devices || []) as PushDevice[]) {
    if (!byUser.has(device.user_id)) byUser.set(device.user_id, []);
    byUser.get(device.user_id)!.push(device);
  }

  const result = { checked: unique.length, sent: 0, skipped: 0, failed: 0 };
  for (const alert of unique) {
    for (const device of byUser.get(alert.user_id) || []) {
      if (device.platform === "android" && !firebaseAccount) { result.skipped++; continue; }
      if (device.platform === "ios" && !hasApple) { result.skipped++; continue; }
      const { data: claim, error: claimError } = await db.from("crm_push_delivery_log").insert({
        device_id: device.id, user_id: alert.user_id, kind: alert.kind,
        source_id: alert.source_id, notification_date: today, state: "pending",
      }).select("id").single();
      if (claimError) {
        if (claimError.code === "23505") { result.skipped++; continue; }
        result.failed++; continue;
      }
      try {
        const delivery = await deliver(device, alert, firebaseAccount);
        const status = delivery.ok ? "sent" : "failed";
        await db.from("crm_push_delivery_log").update({
          state: status, error_code: delivery.ok ? null : delivery.code,
          updated_at: new Date().toISOString(),
        }).eq("id", claim.id);
        if (delivery.ok) result.sent++;
        else result.failed++;
        if (delivery.expired) await db.from("crm_push_devices").update({ active: false }).eq("id", device.id);
      } catch {
        await db.from("crm_push_delivery_log").update({
          state: "failed", error_code: "transport_error",
          updated_at: new Date().toISOString(),
        }).eq("id", claim.id);
        result.failed++;
      }
    }
  }
  return answer(result);
});
