/* Native bridge for the existing CRM, bundled into www/native-bridge.js by esbuild. */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const native = Capacitor.isNativePlatform();
window.DigitalAgronomNative = { platform: Capacitor.getPlatform(), isNative: native };
if (native) {
  window.html2canvas = html2canvas;
  installBridge();
}

function safeName(name) {
  return (String(name || 'material').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').trim().slice(0, 130) || 'material');
}

function dataUrlFor(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Файл не прочитан'));
    reader.readAsDataURL(blob);
  });
}

async function shareBlob(blob, name) {
  const filename = Date.now() + '-' + safeName(name);
  const base64 = await dataUrlFor(blob);
  await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
  await Share.share({
    title: name,
    files: [uri],
    dialogTitle: 'Сохранить или отправить файл',
  });
}

function notice(message) {
  if (typeof window.toast === 'function') window.toast(message);
  else alert(message);
}

function interceptDownloadLinks() {
  // The training library uses an <a download="..."> linked to a Blob.
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[download]');
    if (!anchor || !anchor.href?.startsWith('blob:')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const name = anchor.download || 'material';
    void fetch(anchor.href).then(response => {
      if (!response.ok) throw new Error('Не удалось прочитать файл');
      return response.blob();
    }).then(blob => shareBlob(blob, name)).catch(error => {
      notice('Не удалось сохранить файл: ' + (error?.message || String(error)));
    });
  }, true);
}

function interceptDataExports() {
  // CRM JSON/CSV export creates a detached link which cannot bubble a click event.
  const original = window.download;
  if (typeof original !== 'function') return;
  window.download = (name, content, mime) => {
    const blob = new Blob(['\ufeff', content], { type: mime || 'application/octet-stream' });
    void shareBlob(blob, name).catch(error => {
      notice('Ошибка сохранения экспорта: ' + (error?.message || String(error)));
    });
  };
}

function makeReportWindow() {
  let content = '';
  return {
    closed: false,
    document: {
      open() { content = ''; },
      write(fragment) { content += String(fragment); },
      close() {
        // createPeriodReport expects a synchronous Window, while PDF creation is async.
        void exportNativeReport(content).catch(error => {
          notice('Ошибка формирования отчёта: ' + (error?.message || String(error)));
        });
      },
    },
  };
}

async function exportNativeReport(html) {
  const title = (new DOMParser().parseFromString(html, 'text/html').title || 'Отчёт Цифровой Агроном').replace(/\s*—.*$/, '');
  const fileBase = safeName(title).replace(/\s+/g, '-');
  // Suppress the desktop print() auto-launch embedded in the original report.
  const safeHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed!important;left:-20000px!important;top:0!important;width:920px!important;height:1200px!important;border:0!important;visibility:visible!important;pointer-events:none!important';
  const rendered = new Promise((resolve, reject) => {
    iframe.onload = resolve;
    iframe.onerror = () => reject(new Error('Не удалось открыть макет отчёта'));
  });
  iframe.srcdoc = safeHtml;
  document.body.append(iframe);
  let pdfBlob;
  try {
    await rendered;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const body = iframe.contentDocument?.body;
    if (!body) throw new Error('Пустой макет отчёта');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    await pdf.html(body, {
      x: 0, y: 0,
      margin: [28, 28, 28, 28],
      width: 539,
      windowWidth: 920,
      autoPaging: 'text',
      html2canvas: { scale: 0.58, useCORS: true, logging: false, backgroundColor: '#ffffff' },
    });
    pdfBlob = pdf.output('blob');
  } catch (error) {
    // Preserve the full content if HTML-to-PDF rendering is unsupported on a device.
    notice('PDF недоступен на этом устройстве. Предлагаю сохранить HTML-отчёт вместо PDF.');
    await shareBlob(new Blob([safeHtml], { type: 'text/html;charset=utf-8' }), fileBase + '.html');
    return;
  } finally {
    iframe.remove();
  }
  await shareBlob(pdfBlob, fileBase + '.pdf');
}

function interceptNewWindows() {
  const previous = window.open.bind(window);
  window.open = (url, target, features) => {
    if ((url == null || url === '') && target === '_blank') return makeReportWindow();
    if (typeof url === 'string' && /^https:\/\//i.test(url)) {
      void Browser.open({ url }).catch(error => notice('Не удалось открыть ссылку: ' + error.message));
      return null;
    }
    return previous(url, target, features);
  };
}

async function initAppLifecycle() {
  await App.addListener('backButton', async () => {
    const ui = window.DigitalAgronomMobileUI;
    if (ui?.closeOverlays?.()) return;
    if (ui?.currentSection?.() !== 'dashboard') {
      ui?.navigate?.('dashboard');
      return;
    }
    // On Android, the system back button minimizes the app from its home screen.
    if (Capacitor.getPlatform() === 'android') await App.minimizeApp();
  });
  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive && document.getElementById('app')?.classList.contains('hidden') === false) {
      document.getElementById('overdueRefresh')?.click();
    }
  });
}

function installBridge() {
  interceptDownloadLinks();
  // Existing CRM assigns its handlers synchronously; this module runs after it.
  interceptDataExports();
  interceptNewWindows();
  void initAppLifecycle().catch(error => console.warn('Native lifecycle:', error));
}
