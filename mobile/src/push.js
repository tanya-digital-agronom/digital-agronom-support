import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

const native = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform();
const state = { client: null, userId: null, token: null, subscribed: false, registering: false, connected: false, status: "", pending: null };
const pref = uid => "agro_push_enabled:" + uid;
const installKey = "agro_crm_push_installation";

function installationId() {
  let id = localStorage.getItem(installKey);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(installKey, id); }
  return id;
}
function wanted(uid = state.userId) {
  return !!uid && localStorage.getItem(pref(uid)) === "yes";
}
function setStatus(message) {
  state.status = message;
  refreshControls();
}
function refreshControls() {
  const message = document.getElementById("mobilePushStatus");
  const enable = document.getElementById("mobilePushEnable");
  const disable = document.getElementById("mobilePushDisable");
  if (!message || !enable || !disable) return;
  const enabled = wanted();
  message.textContent = !native ? "Доступно только в установленном приложении."
    : !state.userId ? "Войдите в CRM, чтобы включить уведомления."
    : state.status || (enabled ? "Ожидаем регистрацию телефона…" : "Можно включить уведомления о просрочках.");
  enable.hidden = !native || !state.userId || enabled;
  disable.hidden = !native || !state.userId || !enabled;
  enable.disabled = state.registering;
}
async function deviceRequest(action, token) {
  if (!state.client || !state.userId) throw new Error("Требуется вход в CRM");
  const body = { action, installation_id: installationId() };
  if (action === "register") {
    body.platform = platform;
    body.token = token;
  }
  const { data, error } = await state.client.functions.invoke("crm-push-device", { body });
  if (error) throw new Error(error.message || "Не удалось связаться с Supabase");
  if (!data || (action === "register" && data.enabled !== true)) {
    throw new Error("Регистрация уведомлений не подтверждена");
  }
  return data;
}
async function onRegistered(token) {
  if (!token?.value || !wanted() || !state.userId) return;
  state.token = token.value;
  try {
    const response = await deviceRequest("register", state.token);
    state.connected = true;
    setStatus(response.delivery_ready
      ? "Телефон подключён. Уведомления включены."
      : "Телефон зарегистрирован. Для доставки push нужно завершить настройку Firebase/Apple на сервере.");
  } catch (error) {
    state.connected = false;
    setStatus("Регистрация устройства не удалась: " + (error?.message || String(error)));
  } finally {
    state.registering = false;
    refreshControls();
  }
}
async function setupListeners() {
  if (state.subscribed) return;
  await PushNotifications.addListener("registration", token => { void onRegistered(token); });
  await PushNotifications.addListener("registrationError", err => {
    state.registering = false;
    setStatus("Не удалось подключить push: " + (err?.error || "Проверьте настройки Firebase/Apple."));
  });
  await PushNotifications.addListener("pushNotificationActionPerformed", event => {
    const data = event.notification?.data || {};
    const kind = data.kind;
    const id = data.id;
    if ((kind === "case" || kind === "task") && /^[0-9a-f-]{36}$/i.test(String(id))) {
      state.pending = { kind, id };
      tryOpenPending();
    }
  });
  await PushNotifications.addListener("pushNotificationReceived", () => {
    document.getElementById("overdueRefresh")?.click();
  });
  state.subscribed = true;
}
async function requestRegistration() {
  if (!native || !state.userId || state.registering) return;
  state.registering = true;
  refreshControls();
  try {
    await setupListeners();
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive !== "granted") {
      state.registering = false;
      setStatus("Разрешите уведомления в настройках телефона.");
      return;
    }
    if (platform === "android") {
      await PushNotifications.createChannel({
        id: "crm_overdue",
        name: "Просроченные задачи и обращения",
        description: "Напоминания о просроченных задачах и нерешённых обращениях",
        importance: 5,
        visibility: 1,
        vibration: true,
      });
    }
    setStatus("Регистрируем устройство…");
    await PushNotifications.register();
  } catch (error) {
    state.registering = false;
    setStatus("Ошибка подключения: " + (error?.message || String(error)));
  }
}
async function enable() {
  if (!native || !state.userId) return;
  try {
    await setupListeners();
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive !== "granted") permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") {
      setStatus("Уведомления запрещены. Разрешите их в настройках телефона.");
      return;
    }
    localStorage.setItem(pref(state.userId), "yes");
    refreshControls();
    await requestRegistration();
  } catch (error) {
    setStatus("Не удалось запросить разрешение: " + (error?.message || String(error)));
  }
}
async function disable() {
  const uid = state.userId;
  if (!uid) return;
  try {
    await deviceRequest("disable");
    localStorage.removeItem(pref(uid));
    state.connected = false;
    state.token = null;
    setStatus("Push-уведомления выключены для этого устройства.");
  } catch (error) {
    setStatus("Не удалось отключить уведомления: " + (error?.message || String(error)));
  }
}
async function logout() {
  if (state.userId && wanted()) await disable();
}
let pendingTimer = null;
function tryOpenPending() {
  if (!state.pending || !state.userId) return;
  const bridge = window.DigitalAgronomMobileContext;
  if (!bridge?.openOverdue) return;
  // Wait until CRM has loaded tasks and cases after a cold start.
  let attempt = 0;
  clearInterval(pendingTimer);
  pendingTimer = setInterval(() => {
    if (!state.pending) return clearInterval(pendingTimer);
    attempt++;
    const item = state.pending;
    const current = window.DigitalAgronomMobileUI?.currentSection?.();
    bridge.openOverdue(item.kind, item.id);
    const expected = item.kind === "task" ? "tasks" : "history";
    if (window.DigitalAgronomMobileUI?.currentSection?.() === expected) {
      state.pending = null;
      clearInterval(pendingTimer);
    } else if (attempt >= 20) {
      state.pending = null;
      clearInterval(pendingTimer);
    }
  }, 500);
}
async function authChanged(userId) {
  if (!userId) {
    state.userId = null; state.connected = false;
    setStatus("Войдите в CRM, чтобы включить уведомления.");
    return;
  }
  if (state.userId === userId && state.connected) return;
  state.userId = userId;
  refreshControls();
  if (wanted(userId)) await requestRegistration();
  if (state.pending) tryOpenPending();
}
async function start() {
  if (!native) return;
  const ctx = window.DigitalAgronomMobileContext;
  const client = ctx?.getClient?.();
  if (!client) {
    // CRM initializes its client asynchronously after parsing.
    setTimeout(start, 350);
    return;
  }
  if (state.client) return;
  state.client = client;
  await setupListeners();
  client.auth.onAuthStateChange((_event, session) => {
    // Supabase auth callback must not make awaited database calls.
    queueMicrotask(() => { void authChanged(session?.user?.id || null); });
  });
  const { data } = await client.auth.getSession();
  await authChanged(data?.session?.user?.id || ctx.getUser?.()?.id || null);
  const app = document.getElementById("app");
  if (app) new MutationObserver(() => {
    if (!app.classList.contains("hidden")) {
      const current = ctx.getUser?.()?.id;
      if (current && current !== state.userId) void authChanged(current);
    }
  }).observe(app, { attributes: true, attributeFilter: ["class"] });
}

export function installPush() {
  window.DigitalAgronomNative.push = { enable, disable, logout, refreshControls };
  refreshControls();
  void start().catch(error => setStatus("Ошибка уведомлений: " + (error?.message || String(error))));
}
