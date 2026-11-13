import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');
const [html, css, ui, native, manifest] = await Promise.all([
  readFile(join(www, 'index.html'), 'utf8'),
  readFile(join(www, 'mobile.css'), 'utf8'),
  readFile(join(www, 'mobile-ui.js'), 'utf8'),
  readFile(join(www, 'native-bridge.js'), 'utf8'),
  readFile(join(www, 'manifest.webmanifest'), 'utf8'),
]);

for (const name of ['dashboard', 'new', 'history', 'plan', 'calendar', 'tasks', 'materials', 'knowledge', 'audit', 'users', 'data']) {
  assert.ok(html.includes('id="view-' + name + '"'), 'Не найден раздел: ' + name);
}
for (const id of ['loginForm','caseForm','taskForm','caseReportPdf','taskReportPdf','overdueBell','pageTitle']) {
  assert.ok(html.includes('id="' + id + '"'), 'Не найдена функция CRM: ' + id);
}
assert.ok(html.includes('src="./supabase-sdk.js"') && !html.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js'), 'Supabase SDK должен быть локальным');
assert.ok(html.includes('mobile.css') && html.includes('mobile-ui.js') && html.includes('native-bridge.js'));
assert.ok(css.includes('.mobile-bottom-nav') && css.includes('.mobile-more-drawer'));
assert.ok(ui.includes('DigitalAgronomMobileUI'));
assert.ok(ui.includes('mobilePushEnable') && ui.includes('mobilePushDisable'), 'Нет элементов настройки push в мобильном меню');
assert.ok(html.includes('DigitalAgronomMobileContext'), 'Отсутствует мост к авторизованной сессии CRM');
assert.ok(css.includes('.mobile-push-settings'), 'Нет мобильного оформления push');
const pushCode = await readFile(join(root, 'src', 'push.js'), 'utf8');
assert.ok(pushCode.includes('@capacitor/push-notifications'), 'Не подключён нативный плагин уведомлений');
assert.ok(pushCode.includes('crm-push-device'), 'Отсутствует регистрация устройства в Supabase');
assert.ok(pushCode.includes('pushNotificationActionPerformed'), 'Отсутствует обработка нажатий на push');
new Function(pushCode.replace(/^import[^\n]*$/gm, '').replace('export function installPush()', 'function installPush()'));
const deps = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.ok(deps.dependencies['@capacitor/push-notifications'], 'Push-плагин не указан в пакетах приложения');
assert.ok(css.includes('#app.shell{display:block!important;height:auto!important;min-height:100dvh!important'), 'В мобильном приложении запрещена фиксированная высота контейнера CRM');
assert.ok(css.includes('overflow:visible!important;touch-action:auto!important;overscroll-behavior-y:auto'), 'Главный экран должен использовать прокрутку документа');
assert.ok(ui.includes('document.scrollingElement.scrollTop = 0'), 'Навигация должна сбрасывать прокрутку документа');
assert.ok(native.length > 10000, 'Нативный слой не собран: ожидается пакет Capacitor и PDF');
const sdk = await readFile(join(www, 'supabase-sdk.js'), 'utf8');
assert.ok(sdk.length > 10000, 'Локальный Supabase SDK не собран');
assert.equal(JSON.parse(manifest).display, 'standalone');
for (const name of ['icon-192.png', 'icon-512.png']) {
  const { size } = await stat(join(www, 'icons', name));
  assert.ok(size > 1000, 'Значок слишком мал: ' + name);
}
const publicJs = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  .map(m => m[1]).filter(s => s.trim());
for (const snippet of publicJs) new Function(snippet);
new Function(ui);
console.log('✓ Сохранены 11 разделов CRM и Supabase');
console.log('✓ Мобильная навигация и native bridge на месте');
console.log('✓ JavaScript CRM и мобильного интерфейса прошёл проверку синтаксиса');
console.log('✓ PWA manifest и иконки созданы');
