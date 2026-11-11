// Material Next kit runtime. Plain script, no deps. Exposes window.mn. API: references/components.md
(() => {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const store = {
    get: k => { try { return localStorage.getItem('mn:' + k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem('mn:' + k) : localStorage.setItem('mn:' + k, v); } catch {} },
  };

  // ---- Icons: <i data-icon="name"></i> (Material Icons paths, Apache-2.0) ---------------------
  const P = {
    menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
    search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    chevron: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
    expand: 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z',
    settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
    home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
    heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5a3 3 0 1 0-5.91.7L8.04 9.81A2.99 2.99 0 0 0 3 12a2.99 2.99 0 0 0 5.04 2.19l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z',
    upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
    download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    play: 'M8 5v14l11-7z',
    pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
    person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
    bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    error: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
    lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z',
    file: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
    image: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
    folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
    mail: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z',
    calendar: 'M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z',
    send: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z',
    mic: 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
    attach: 'M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z',
    undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
    refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
    tune: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
    grid: 'M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z',
    list: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
    merge: 'M17 20.41 18.41 19 15 15.59 13.59 17 17 20.41zM7.5 8H11v5.59L5.59 19 7 20.41l6-6V8h3.5L12 3.5 7.5 8z',
    split: 'M14 4l2.29 2.29-2.88 2.88 1.42 1.42 2.88-2.88L20 10V4zm-4 0H4v6l2.29-2.29 4.71 4.7V20h2v-8.41l-5.29-5.3z',
    compress: 'M8 19h3v3h2v-3h3l-4-4-4 4zm8-15h-3V1h-2v3H8l4 4 4-4zM4 9v2h16V9H4zm0 3h16v2H4z',
    subtitles: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z',
    dark: 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z',
    light: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM2 13h2a1 1 0 0 0 0-2H2a1 1 0 0 0 0 2zm18 0h2a1 1 0 0 0 0-2h-2a1 1 0 0 0 0 2zM11 2v2a1 1 0 0 0 2 0V2a1 1 0 0 0-2 0zm0 18v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-2 0zM5.99 4.58a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41L5.99 4.58zm12.37 12.37a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41l-1.06-1.06zm1.06-10.96a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06zM7.05 18.36a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06z',
    sparkle: 'M12 2c.6 5.1 2.9 7.4 10 10-7.1 2.6-9.4 4.9-10 10-.6-5.1-2.9-7.4-10-10 7.1-2.6 9.4-4.9 10-10z',
    open: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
    history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.95 8.95 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  };
  const icon = name => P[name] ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name]}"/></svg>` : '';
  const fillIcons = (scope = document) => {
    scope.querySelectorAll?.('[data-icon]').forEach(el => {
      if (el.dataset.iconDone !== el.dataset.icon) { el.innerHTML = icon(el.dataset.icon); el.dataset.iconDone = el.dataset.icon; }
    });
  };
  const stagger = (scope = document) => scope.querySelectorAll?.('.mn-stagger').forEach(list =>
    [...list.children].forEach((c, i) => c.style.setProperty('--i', i)));

  // ---- Navigation with view transitions --------------------------------------------------------
  // mn.go(render, { type: 'forward'|'back'|'fade', morph: [fromEl, toSelector] })
  async function go(update, { type = 'fade', morph } = {}) {
    if (!document.startViewTransition || reduced.matches) { await update(); fillIcons(); stagger(); return; }
    if (morph?.[0]) morph[0].style.viewTransitionName = 'mn-morph';
    const run = async () => {
      if (morph?.[0]) morph[0].style.viewTransitionName = '';
      await update(); fillIcons(); stagger();
      const to = typeof morph?.[1] === 'string' ? document.querySelector(morph[1]) : morph?.[1];
      if (to) to.style.viewTransitionName = 'mn-morph';
    };
    let vt;
    try { vt = document.startViewTransition({ update: run, types: [type] }); } catch { vt = document.startViewTransition(run); }
    await vt.finished.catch(() => {});
    document.querySelectorAll('[style*="view-transition-name"]').forEach(el => { if (el.style.viewTransitionName === 'mn-morph') el.style.viewTransitionName = ''; });
  }

  // ---- Snackbar ---------------------------------------------------------------------------------
  // mn.toast('Deleted 3 files', { action: 'Undo', onAction: fn, timeout: 5000 })
  let bar, barTimer;
  function toast(text, { action, onAction, timeout = action ? 6000 : 4000 } = {}) {
    dismiss(true);
    bar = document.createElement('div');
    bar.className = 'mn-snackbar'; bar.setAttribute('role', 'status');
    bar.innerHTML = `<span></span>${action ? '<button class="mn-btn text"></button>' : ''}`;
    bar.firstChild.textContent = text;
    if (action) { const b = bar.querySelector('button'); b.textContent = action; b.onclick = () => { onAction?.(); dismiss(); }; }
    document.body.append(bar);
    barTimer = setTimeout(dismiss, timeout);
    return dismiss;
  }
  function dismiss(now) {
    clearTimeout(barTimer);
    const b = bar; bar = null;
    if (!b) return;
    if (now === true || reduced.matches) return b.remove();
    b.classList.add('leaving'); setTimeout(() => b.remove(), 300);
  }

  // ---- Sheets: <button data-sheet="id">, <dialog class="mn-sheet" id="id">. Backdrop tap + drag-down close.
  function sheet(id) { const d = typeof id === 'string' ? document.getElementById(id) : id; d?.showModal(); return d; }
  document.addEventListener('click', e => {
    const opener = e.target.closest('[data-sheet]');
    if (opener) return sheet(opener.dataset.sheet);
    if (e.target.matches('dialog.mn-sheet[open]')) {
      const r = e.target.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) e.target.close();
    }
    if (e.target.closest('.mn-seg > *')) {
      const btn = e.target.closest('.mn-seg > *'), seg = btn.parentElement;
      if (!seg.hasAttribute('data-multi')) seg.querySelectorAll('[aria-pressed]').forEach(b => b.setAttribute('aria-pressed', b === btn));
      haptic('tick');
    }
  });
  let drag;
  document.addEventListener('pointerdown', e => {
    const d = e.target.closest('dialog.mn-sheet[open]');
    if (!d || matchMedia('(min-width: 840px)').matches || d.scrollTop > 0 || e.target.closest('input, textarea, select, button, a')) return;
    drag = { d, y: e.clientY, t: e.timeStamp, dy: 0, v: 0 };
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = Math.max(0, e.clientY - drag.y);
    drag.v = (dy - drag.dy) / Math.max(1, e.timeStamp - drag.t); drag.dy = dy; drag.t = e.timeStamp;
    if (dy > 4) { drag.d.classList.add('dragging'); drag.d.style.translate = `0 ${dy}px`; }
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    const { d, dy, v } = drag; drag = null;
    d.classList.remove('dragging'); d.style.translate = '';
    if (dy > d.offsetHeight * 0.3 || v > 0.6) { haptic('threshold'); d.close(); }
  });

  // ---- Files: whole window is a drop target; dispatches 'mn:files' on document ------------------
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files');
  addEventListener('dragenter', e => { if (hasFiles(e) && document.querySelector('.mn-drop')) { depth++; root.dataset.dragging = ''; } });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; delete root.dataset.dragging; } });
  addEventListener('dragover', e => { if (hasFiles(e) && document.querySelector('.mn-drop')) e.preventDefault(); });
  addEventListener('drop', e => {
    depth = 0; delete root.dataset.dragging;
    if (!hasFiles(e) || !document.querySelector('.mn-drop')) return;
    e.preventDefault(); emitFiles(e.dataTransfer.files);
  });
  addEventListener('paste', e => { if (e.clipboardData?.files.length && document.querySelector('.mn-drop')) emitFiles(e.clipboardData.files); });
  document.addEventListener('change', e => {
    if (e.target.matches('.mn-drop input[type=file]')) { emitFiles(e.target.files); e.target.value = ''; }
    if (e.target.matches('.mn-switch')) haptic(e.target.checked ? 'confirm' : 'tick');
  });
  const emitFiles = files => files?.length && document.dispatchEvent(new CustomEvent('mn:files', { detail: [...files] }));

  // ---- Teach once: [data-once="key"] shows until mn.done("key"); [data-after="key"] shows after ---
  function syncOnce() {
    document.querySelectorAll('[data-once]').forEach(el => { el.hidden = !!store.get('done:' + el.dataset.once); });
    document.querySelectorAll('[data-after]').forEach(el => { el.hidden = !store.get('done:' + el.dataset.after); });
  }
  const done = key => { if (!store.get('done:' + key)) { store.set('done:' + key, '1'); go(syncOnce); } };

  // ---- Menus: popover positioned under its invoker ----------------------------------------------
  document.addEventListener('toggle', e => {
    const m = e.target;
    if (!m.matches?.('.mn-menu') || e.newState !== 'open') return;
    const inv = document.querySelector(`[popovertarget="${m.id}"]`);
    if (!inv) return;
    const r = inv.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    const left = Math.min(Math.max(8, r.right - w), innerWidth - w - 8);
    const top = r.bottom + 4 + h > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    Object.assign(m.style, { left: left + 'px', top: top + 'px', position: 'fixed' });
  }, true);
  document.addEventListener('click', e => { if (e.target.closest('.mn-menu > :is(button, a)')) e.target.closest('.mn-menu').hidePopover?.(); });

  // ---- Haptics, theme, dial ---------------------------------------------------------------------
  const PATTERNS = { tick: 8, confirm: [10, 40, 14], reject: [30, 60, 30], threshold: 14, long: 20 };
  function haptic(kind) { if (!reduced.matches) navigator.vibrate?.(PATTERNS[kind] ?? 8); }
  function theme(mode) {
    if (mode === undefined) return root.dataset.theme ?? 'system';
    mode === 'system' ? delete root.dataset.theme : (root.dataset.theme = mode);
    store.set('theme', mode === 'system' ? null : mode);
  }
  function dial(level) {
    if (level === undefined) return root.dataset.expressiveness;
    root.dataset.expressiveness = level; store.set('dial', level);
  }
  const saved = { theme: store.get('theme'), dial: store.get('dial') };
  if (saved.theme) root.dataset.theme = saved.theme;
  if (saved.dial) root.dataset.expressiveness = saved.dial;

  // ---- Boot ---------------------------------------------------------------------------------------
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => { root.toggleAttribute('data-scrolled', scrollY > 4); ticking = false; });
  }, { passive: true });
  const boot = () => {
    fillIcons(); stagger(); syncOnce();
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { fillIcons(n.parentNode ?? n); stagger(n.parentNode ?? n); } })
      .observe(document.body, { childList: true, subtree: true });
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();

  window.mn = { go, toast, sheet, done, haptic, theme, dial, icon, icons: Object.keys(P), store };
})();
