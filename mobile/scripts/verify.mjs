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
assert.ok(html.includes('supabase.min.js'), 'Supabase SDK не подключён');
assert.ok(html.includes('mobile.css') && html.includes('mobile-ui.js') && html.includes('native-bridge.js'));
assert.ok(css.includes('.mobile-bottom-nav') && css.includes('.mobile-more-drawer'));
assert.ok(ui.includes('DigitalAgronomMobileUI'));
assert.ok(native.length > 10000, 'Нативный слой не собран: ожидается пакет Capacitor и PDF');
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
