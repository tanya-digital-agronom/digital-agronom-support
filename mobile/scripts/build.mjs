import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import sharp from 'sharp';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDir = resolve(projectDir, '..');
const webDir = join(projectDir, 'www');
const iconsDir = join(webDir, 'icons');
const assetDir = join(projectDir, 'assets');
await Promise.all([
  mkdir(webDir, { recursive: true }),
  mkdir(iconsDir, { recursive: true }),
  mkdir(assetDir, { recursive: true }),
]);

const original = await readFile(join(repositoryDir, 'crm.html'), 'utf8');
if (!original.includes('id="view-dashboard"') ||
    !original.includes('id="view-history"') ||
    !original.includes('id="view-tasks"') ||
    !original.includes('id="view-materials"') ||
    !original.includes('supabase')) {
  throw new Error('Исходная CRM не найдена или не содержит обязательные разделы.');
}
if (/(?:['\"]|=)sb_secret_[a-zA-Z0-9_-]{12,}/.test(original)) {
  // The public CRM must never include server-only secrets.
  throw new Error('В CRM найдены признаки служебного ключа Supabase — сборка остановлена.');
}

const headEnd = original.indexOf('</head>');
const bodyEnd = original.lastIndexOf('</body>');
if (headEnd < 0 || bodyEnd < 0) throw new Error('Не найдены основные теги HTML.');

const mobileHead =
  '<meta name="theme-color" content="#F6F7F5">' +
  '<meta name="apple-mobile-web-app-capable" content="yes">' +
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">' +
  '<link rel="manifest" href="./manifest.webmanifest">' +
  '<link rel="apple-touch-icon" href="./icons/icon-192.png">' +
  '<link rel="stylesheet" href="./mobile.css">';
const withViewport = original.replace(
  /<meta name="viewport" content="[^"]*">/i,
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
);
const afterHead = withViewport.replace('</head>', mobileHead + '</head>');
const lastBody = afterHead.lastIndexOf('</body>');
const additions = '<script src="./mobile-ui.js" defer></script>' +
  '<script src="./native-bridge.js" defer></script>';
const appHtml = afterHead.slice(0, lastBody) + additions + afterHead.slice(lastBody);
await writeFile(join(webDir, 'index.html'), appHtml);
await Promise.all([
  copyFile(join(projectDir, 'src', 'mobile.css'), join(webDir, 'mobile.css')),
  copyFile(join(projectDir, 'src', 'mobile-ui.js'), join(webDir, 'mobile-ui.js')),
  copyFile(join(projectDir, 'src', 'manifest.webmanifest'), join(webDir, 'manifest.webmanifest')),
]);

// Bundle official Capacitor plugins; keep working when the same web bundle is opened in a browser.
await esbuild({
  entryPoints: [join(projectDir, 'src', 'native-bridge.js')],
  outfile: join(webDir, 'native-bridge.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome100', 'safari15'],
  minify: true,
  logLevel: 'warning',
});

// Bootstrap icon assets from the CRM's actual favicon. A dedicated high-resolution
// brand icon can replace these later before publication in app stores.
const favicon = /<link rel="icon"[^>]*href="data:image\/png;base64,([^"]+)"/i.exec(original);
if (!favicon) throw new Error('В CRM не найден исходный фирменный значок.');
const image = Buffer.from(favicon[1], 'base64');
await Promise.all([
  sharp(image).resize(192, 192, { fit: 'contain', background: '#ffffff' }).png().toFile(join(iconsDir, 'icon-192.png')),
  sharp(image).resize(512, 512, { fit: 'contain', background: '#ffffff' }).png().toFile(join(iconsDir, 'icon-512.png')),
  sharp(image).resize(1024, 1024, { fit: 'contain', background: '#ffffff' }).png().toFile(join(assetDir, 'icon.png')),
]);

console.log('✓ Мобильный интерфейс создан из актуального ../crm.html');
console.log('✓ Разделы, авторизация и Supabase сохранены');
console.log('✓ Готово для Capacitor Android / iOS: mobile/www');
