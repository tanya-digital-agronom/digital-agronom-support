/* Mobile UX enhancement for the existing CRM. Reuses the original .nav handlers. */
(() => {
  'use strict';
  if (window.DigitalAgronomMobileUI) return;

  const sections = [
    ['dashboard', 'Главная', 'layout'],
    ['history', 'Обращения', 'clipboard'],
    ['tasks', 'Задачи', 'tasks'],
    ['materials', 'Материалы', 'file'],
  ];
  const icons = {
    layout: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',
    clipboard: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 3h6v4H9zM9 12h6M9 16h6"/>',
    tasks: '<path d="m4 7 2 2 3-3M12 8h8M4 15l2 2 3-3M12 16h8"/>',
    file: '<path d="M5 3h9l5 5v13H5zM14 3v5h5M9 13h6M9 17h6"/>',
    more: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  };
  const icon = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>';
  const $ = id => document.getElementById(id);

  function init() {
    const app = $('app');
    const sidebar = app?.querySelector('.side');
    const main = app?.querySelector('.main');
    if (!app || !sidebar || !main) return;

    const brand = document.createElement('div');
    brand.className = 'mobile-brandbar';
    const originalLogo = sidebar.querySelector('.identity img');
    const logo = document.createElement('button');
    logo.type = 'button';
    logo.className = 'mobile-brand-logo';
    logo.title = 'Обновить приложение';
    logo.setAttribute('aria-label', 'Цифровой Агроном — обновить приложение');
    const img = document.createElement('img');
    img.alt = '';
    if (originalLogo) img.src = originalLogo.src;
    const label = document.createElement('span');
    label.append('Цифровой Агроном');
    const caption = document.createElement('small');
    caption.textContent = 'Система поддержки внедрения';
    label.append(caption);
    logo.append(img, label);
    logo.addEventListener('click', () => location.reload());
    const avatar = document.createElement('button');
    avatar.type = 'button';
    avatar.className = 'mobile-brand-avatar';
    avatar.setAttribute('aria-label', 'Открыть дополнительные разделы и профиль');
    avatar.textContent = 'ЦА';
    brand.append(logo, avatar);
    main.insertBefore(brand, main.firstChild);

    const nav = document.createElement('nav');
    nav.className = 'mobile-bottom-nav';
    nav.setAttribute('aria-label', 'Основное меню приложения');
    sections.forEach(([key, title, symbol]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-tab';
      button.dataset.mobileNav = key;
      button.innerHTML = icon(symbol) + '<span>' + title + '</span>';
      button.addEventListener('click', () => navigate(key));
      nav.append(button);
    });
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'mobile-tab';
    more.dataset.mobileNav = 'more';
    more.setAttribute('aria-expanded', 'false');
    more.innerHTML = icon('more') + '<span>Ещё</span>';
    nav.append(more);
    app.append(nav);

    const backdrop = document.createElement('div');
    backdrop.className = 'mobile-more-backdrop';
    backdrop.hidden = true;
    const drawer = document.createElement('section');
    drawer.className = 'mobile-more-drawer';
    drawer.hidden = true;
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Все разделы приложения');
    drawer.setAttribute('aria-modal', 'true');
    drawer.innerHTML =
      '<div class="mobile-more-heading"><div><strong>Все разделы</strong><small>Цифровой Агроном · CRM</small></div>' +
      '<button type="button" class="mobile-more-close" aria-label="Закрыть меню">×</button></div>' +
      '<div class="mobile-more-list"></div>' +
      '<div class="mobile-more-profile"><div class="mobile-more-user"><span></span><small></small></div>' +
      '<button type="button" class="mobile-logout">Выйти</button></div>';
    app.append(backdrop, drawer);

    const list = drawer.querySelector('.mobile-more-list');

    function currentSection() {
      return sidebar.querySelector('.nav.active[data-nav]')?.dataset.nav || 'dashboard';
    }

    function updateTabs() {
      const key = currentSection();
      nav.querySelectorAll('.mobile-tab').forEach(button => {
        const match = button.dataset.mobileNav === key || (button.dataset.mobileNav === 'more' && !sections.some(item => item[0] === key));
        button.classList.toggle('is-active', match);
        if (match && button.dataset.mobileNav !== 'more') button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
      if (!drawer.hidden) {
        drawer.querySelectorAll('.mobile-more-item').forEach(button => button.classList.toggle('is-active', button.dataset.mobileGo === key));
      }
    }

    function closeMore() {
      backdrop.hidden = true;
      drawer.hidden = true;
      more.setAttribute('aria-expanded', 'false');
    }

    function renderMore() {
      list.replaceChildren();
      sidebar.querySelectorAll('.nav[data-nav]').forEach(item => {
        if (item.classList.contains('hidden')) return;
        const key = item.dataset.nav;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mobile-more-item';
        btn.dataset.mobileGo = key;
        btn.innerHTML = (item.querySelector('svg')?.outerHTML || icon('file')) +
          '<span>' + (item.querySelector('span')?.textContent || item.textContent.trim()) + '</span>';
        btn.addEventListener('click', () => navigate(key));
        list.append(btn);
      });
      drawer.querySelector('.mobile-more-user span').textContent = $('who')?.textContent || 'Сотрудник';
      drawer.querySelector('.mobile-more-user small').textContent = $('whoEmail')?.textContent || '';
      const initial = ($('who')?.textContent?.trim() || 'ЦА').slice(0, 1).toLocaleUpperCase('ru-RU');
      avatar.textContent = initial;
      updateTabs();
    }

    function openMore() {
      renderMore();
      backdrop.hidden = false;
      drawer.hidden = false;
      more.setAttribute('aria-expanded', 'true');
      drawer.querySelector('.mobile-more-close')?.focus({ preventScroll: true });
    }

    function navigate(key) {
      const target = sidebar.querySelector('.nav[data-nav="' + key + '"]');
      if (!target || target.classList.contains('hidden')) return;
      closeMore();
      target.click(); // Runs existing CRM navigation (permissions / data loading unchanged).
      updateTabs();
      // The document is the sole scrolling surface on Android and iPhone.
      // Reset the native viewport after changing CRM sections.
      window.scrollTo(0, 0);
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    }

    function closeOverlays() {
      if (!drawer.hidden) { closeMore(); return true; }
      const bell = $('overdueBell');
      if (bell?.getAttribute('aria-expanded') === 'true') { bell.click(); return true; }
      const popover = document.querySelector('.case-date-popover:not(.hidden),.cal-filter-menu:not(.hidden)');
      if (popover) { popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; }
      return false;
    }

    more.addEventListener('click', () => drawer.hidden ? openMore() : closeMore());
    avatar.addEventListener('click', openMore);
    backdrop.addEventListener('click', closeMore);
    drawer.querySelector('.mobile-more-close').addEventListener('click', closeMore);
    drawer.querySelector('.mobile-logout').addEventListener('click', () => { closeMore(); $('logout')?.click(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !drawer.hidden) closeMore(); });
    const activeObserver = new MutationObserver(() => updateTabs());
    sidebar.querySelectorAll('.nav[data-nav]').forEach(button => activeObserver.observe(button, { attributes: true, attributeFilter: ['class'] }));
    updateTabs();

    const columns = {
      historyRows: ['Дата', 'Комбинат / теплица', 'Мастер', 'Запрос и решение', 'Статус', 'Автор обращения', 'Действия'],
      taskRows: ['Задача', 'Исполнитель', 'Начало / срок', 'Статус', 'Вложения', 'Действия'],
    };
    Object.entries(columns).forEach(([id, labels]) => {
      const root = $(id);
      if (!root) return;
      function decorate() {
        Array.from(root.children).forEach(row => {
          Array.from(row.children).forEach((cell, i) => {
            cell.dataset.mobileLabel = labels[i] || '';
          });
        });
      }
      new MutationObserver(decorate).observe(root, { childList: true });
      decorate();
    });
    window.DigitalAgronomMobileUI = { navigate, openMore, closeMore, closeOverlays, currentSection };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
