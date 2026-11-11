/* Pagewise: edit any HTML file page by page, like a document.
   Material Next design language: independent, built on M3; not an official Google design.

   How it works
   - SOURCE: the opened file is parsed with DOMParser into an inert document (scripts never run there).
     Every element in <body> gets a data-wy id. Saving serializes this document, minus the ids,
     so the doctype, <head>, styles and scripts come back exactly as they were.
   - VIEW: a sandboxed iframe renders a copy of the source with the file's own scripts running
     (so drawings made by code still show). A tiny bootstrap script forwards every input event to
     the editor first, so the page's own keyboard/click handlers (slide navigation etc.) stay quiet.
   - Edits happen in the view and are mirrored into the source by id. Text typed into a block is
     copied back with flush(); attribute/structure changes are applied to both with mirror().
   - PAGES: found in the source (.slide, .page, section[data-title], …, or repeated sections);
     the view hides all pages except the current one with editor-only CSS. */
(() => {
'use strict';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); d.now = (...a) => { clearTimeout(t); fn(...a); }; return d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cssEsc = s => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/"/g, '\\"');
const toast = (t, o) => window.mn ? mn.toast(t, o) : console.log(t);
const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ============================== STATE ============================== */
const S = {
  doc: null, doctype: '', name: 'Untitled.html', handle: null, baseHref: null, draftId: null,
  pages: [], cur: 0, single: false,
  hist: [], hi: -1, dirty: false, nextId: 1, pageVer: {},
};
const V = { win: null, doc: null, ready: false, gen: 0, scale: 1 };       // live view
const E = { el: null, dirty: false, start: null, range: null, link: null }; // text being edited
let SEL = null;                                                            // { kind: 'box'|'pic'|'label', el }

const INLINE = new Set('a abbr b bdi bdo br cite code data dfn em i kbd mark q s samp small span strong sub sup time u var wbr font del ins img svg label'.split(' '));
const NEVER_TEXT = new Set('html body head script style svg img table thead tbody tfoot tr ul ol dl select textarea input iframe video audio canvas hr br picture source object embed template noscript'.split(' '));
const EMPTY_OK = new Set('p h1 h2 h3 h4 h5 h6 li td th blockquote figcaption dt dd caption'.split(' '));
const EDITOR_ATTRS = ['data-wy-hover', 'data-wy-sel', 'data-wy-edit', 'contenteditable', 'spellcheck'];

const newId = () => 'w' + (S.nextId++).toString(36);
const idOf = el => el?.getAttribute?.('data-wy') || null;
const sq = id => id && S.doc.querySelector(`[data-wy="${cssEsc(id)}"]`);
const vqa = id => (id && V.doc) ? [...V.doc.querySelectorAll(`[data-wy="${cssEsc(id)}"]`)] : [];
const vq = id => vqa(id)[0] || null;
const curId = () => S.pages[S.cur];
const curViewEl = () => vq(curId());

/* ============================== DOCUMENT MODEL ============================== */
function parse(text) {
  return new DOMParser().parseFromString(text, 'text/html');
}
function assignIds(root) {
  if (root.nodeType === 1 && !idOf(root)) root.setAttribute('data-wy', newId());
  root.querySelectorAll?.('*').forEach(el => { if (!idOf(el)) el.setAttribute('data-wy', newId()); });
}
const VOID = new Set('area base br col embed hr img input keygen link meta param source track wbr basefont bgsound frame'.split(' '));
const RAW = new Set('style script xmp iframe noembed noframes plaintext'.split(' '));
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const escText = t => t.replace(/&/g, '&amp;').replace(/\u00a0/g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = t => t.replace(/&/g, '&amp;').replace(/\u00a0/g, '&nbsp;').replace(/"/g, '&quot;');
// HTML serializer that stays close to how files are usually written: empty SVG/MathML elements
// are written self-closing (<path/>), and the line break between <html> and <head> is kept.
function serNode(n, keepIds, out, plain) {
  if (n.nodeType === 3) {
    const p = n.parentNode;
    out.push(p && p.namespaceURI === HTML_NS && RAW.has(p.localName) ? n.data : escText(n.data));
    return;
  }
  if (n.nodeType === 8) { out.push(`<!--${n.data}-->`); return; }
  if (n.nodeType !== 1) return;
  const tag = n.namespaceURI === HTML_NS ? n.localName : n.tagName;
  let s = '<' + tag;
  for (const a of n.attributes) {
    if (!keepIds && a.name === 'data-wy') continue;
    s += ' ' + a.name + '="' + escAttr(a.value) + '"';
  }
  const html = n.namespaceURI === HTML_NS;
  if (html && VOID.has(tag)) { out.push(s + '>'); return; }
  const kids = html && tag === 'template' ? n.content.childNodes : n.childNodes;
  if (!html && !kids.length) { out.push(s + '/>'); return; }
  out.push(s + '>');
  if (!plain && html && tag === 'html' && S.htmlGap && kids[0]?.nodeType === 1 && kids[0].localName === 'head') out.push(S.htmlGap);
  for (const k of kids) serNode(k, keepIds, out, plain);
  out.push('</' + tag + '>');
}
function serialize(keepIds) {
  const out = [];
  let first = true;
  for (const n of S.doc.childNodes) {
    if (!first) out.push('\n');
    first = false;
    if (n.nodeType === 10) out.push(S.doctype || '<!DOCTYPE html>');
    else serNode(n, keepIds, out);
  }
  return out.join('') + '\n';
}

/* ---- Faithful save: reuse the original text of everything that did not change ----
   At load the original text is tokenized and each element is matched to its start/end tag
   positions. On save, any element whose content is unchanged is copied byte for byte from the
   original; changed elements are rebuilt, reusing their original start/end tags when possible.
   The result is verified by re-parsing; if anything differs, the plain serializer is used. */
const RAW_TEXT = new Set('script style textarea title xmp iframe noembed noframes plaintext'.split(' '));
function tokenize(text) {
  const toks = []; const n = text.length; let i = 0;
  while (i < n) {
    const lt = text.indexOf('<', i); if (lt < 0) break; i = lt;
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); i = e < 0 ? n : e + 3; continue; }
    const c1 = text[i + 1];
    if (c1 === '!' || c1 === '?') { const e = text.indexOf('>', i); i = e < 0 ? n : e + 1; continue; }
    if (c1 === '/') {
      const m = /^<\/([a-zA-Z][^\s/>]*)[^>]*>/.exec(text.slice(i, i + 300));
      if (m) { toks.push({ end: true, name: m[1].toLowerCase(), s: i, e: i + m[0].length }); i += m[0].length; } else i++;
      continue;
    }
    const m = /^<([a-zA-Z][^\s/>]*)/.exec(text.slice(i, i + 120));
    if (!m) { i++; continue; }
    let j = i + m[0].length, q = null;
    while (j < n) { const c = text[j]; if (q) { if (c === q) q = null; } else if ((c === '"' || c === "'") && /[=\s]/.test(text[j - 1] || '')) q = c; else if (c === '>') break; j++; }
    const name = m[1].toLowerCase();
    const t = { end: false, name, s: i, e: j + 1, selfClose: text[j - 1] === '/' };
    toks.push(t); i = j + 1;
    if (RAW_TEXT.has(name)) {
      const re = new RegExp('</' + name + '[\\s>]', 'ig'); re.lastIndex = i;
      const mm = re.exec(text);
      if (mm) { const e = text.indexOf('>', mm.index); toks.push({ end: true, name, s: mm.index, e: e + 1 }); i = e + 1; } else i = n;
    }
  }
  // Pair start and end tags with a stack
  const stack = [];
  for (const t of toks) {
    if (!t.end) {
      if (VOID.has(t.name) || t.selfClose) { t.closed = true; continue; }
      stack.push(t);
    } else {
      for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === t.name) { stack[k].endTok = t; stack.length = k; break; }
    }
  }
  return toks.filter(t => !t.end);
}
function mapSpans(doc, text) {
  const starts = tokenize(text);
  const spans = new Map();
  const els = [doc.documentElement, ...doc.documentElement.querySelectorAll('*')];
  let p = 0;
  for (const el of els) {
    const name = el.tagName.toLowerCase();
    let k = -1;
    for (let q = p; q < Math.min(starts.length, p + 4); q++) if (starts[q].name === name) { k = q; break; }
    if (k < 0) continue;
    const t = starts[k]; p = k + 1;
    const raw = text.slice(t.s, t.e).toLowerCase();
    if (![...el.attributes].every(a => a.name === 'data-wy' || raw.includes(a.name.toLowerCase()))) continue;
    const id = el.getAttribute('data-wy') || (el === doc.documentElement ? '#html' : el.localName === 'head' ? '#head' : null);
    if (!id) continue;
    spans.set(id, { s: t.s, e: t.e, es: t.endTok ? t.endTok.s : null, ee: t.endTok ? t.endTok.e : (t.closed ? t.e : null), selfClose: t.selfClose });
  }
  // Containment sanity: a child's span must sit inside its parent's span
  for (const el of els) {
    const id = spanKey(el), sp = spans.get(id); if (!sp) continue;
    const par = el.parentElement && spans.get(spanKey(el.parentElement));
    if (par && (sp.s < par.e || (par.es != null && sp.s > par.es))) spans.delete(id);
  }
  return spans;
}
const spanKey = el => el.getAttribute('data-wy') || (el.localName === 'html' ? '#html' : el.localName === 'head' ? '#head' : '');
function normMap(root) {
  const map = new Map();
  const walk = el => {
    const out = [];
    serNode(el, false, out, true);
    const str = out.join('');
    map.set(spanKey(el), str);
    for (const c of (el.localName === 'template' ? [] : el.children)) walk(c);
    return str;
  };
  walk(root);
  return map;
}
function startTagOf(el) { const out = []; const c = el.cloneNode(false); serNode(c, false, out, true); const s = out.join(''); return s.slice(0, s.lastIndexOf('</') > 0 ? s.lastIndexOf('</') : s.length); }
function plainSerialize(doc) {
  const out = []; let first = true;
  for (const n of doc.childNodes) { if (!first) out.push('\n'); first = false; if (n.nodeType === 10) out.push('<!DOCTYPE html>'); else serNode(n, false, out, true); }
  return out.join('');
}
function faithfulSerialize() {
  const O = S.orig; if (!O || !O.text) return serialize(false);
  try {
    const text = O.text, sp = O.spans;
    const cur = normMap(S.doc.documentElement);
    const want = plainSerialize(S.doc);
    const build = explicitEnds => {
    const out = [];
    const emit = el => {
      const id = spanKey(el), s = sp.get(id);
      if (s && s.ee != null && O.norm.get(id) === cur.get(id)) { out.push(text.slice(s.s, s.ee)); return; }
      const origEl = O.byId.get(id);
      if (s && origEl && startTagOf(origEl) === startTagOf(el)) out.push(text.slice(s.s, s.e));
      else { const o = []; serNode(el.cloneNode(false), false, o, true); const st = o.join(''); out.push(st.slice(0, st.lastIndexOf('</') > 0 ? st.lastIndexOf('</') : st.length).replace(/\/>$/, '>')); }
      const html = el.namespaceURI === HTML_NS, tag = html ? el.localName : el.tagName;
      if (html && VOID.has(tag)) return;
      const kids = html && tag === 'template' ? [...el.content.childNodes] : [...el.childNodes];
      if (!html && !kids.length) { if (!(s && s.selfClose && startTagOf(origEl || el) === startTagOf(el))) { out[out.length - 1] = out[out.length - 1].replace(/>$/, '/>'); } return; }
      if (tag === 'html') {
        const head = kids[0]?.nodeType === 1 && kids[0].localName === 'head' ? sp.get('#head') : null;
        if (s && head) { const gap = text.slice(s.e, head.s); if (/^\s*$/.test(gap)) out.push(gap); }
      }
      let tail = '', strip = 0;
      if (tag === 'body') {
        // Whitespace after </body> and </html> is parsed into <body>; put it back where it was.
        const hs = sp.get('#html'), last = kids[kids.length - 1];
        if (s && s.ee != null && hs && hs.es != null && hs.ee != null) {
          const gap = text.slice(s.ee, hs.es), after = text.slice(hs.ee);
          const moved = gap + (/^\s*$/.test(after) ? after : '');
          if (gap && /^\s*$/.test(gap) && last?.nodeType === 3 && last.data.endsWith(moved)) { tail = gap; strip = moved.length; }
        }
      }
      kids.forEach((k, i) => {
        if (k.nodeType === 1) emit(k);
        else if (k.nodeType === 3) {
          let d = k.data;
          if (strip && i === kids.length - 1) d = d.slice(0, d.length - strip);
          serNode({ nodeType: 3, data: d, parentNode: el }, false, out, true);
        } else if (k.nodeType === 8) out.push(`<!--${k.data}-->`);
      });
      if (s && s.es != null) out.push(text.slice(s.es, s.ee));
      else if (explicitEnds || !s) out.push(`</${tag}>`);
      if (tail) out.push(tail);
    };
    const hs = sp.get('#html');
    out.push(text.slice(0, hs.s));
    emit(S.doc.documentElement);
    out.push(text.slice(hs.ee));
    return out.join('');
    };
    if (!sp.get('#html') || sp.get('#html').ee == null) return serialize(false);
    // Verify: the rebuilt text must parse to exactly the current document
    for (const explicit of [false, true]) {
      const result = build(explicit);
      if (plainSerialize(parse(result)) === want) return result;
    }
    console.warn('Pagewise: faithful save mismatch, using plain serializer');
    return serialize(false);
  } catch (e) { console.warn('Pagewise: faithful save failed', e); return serialize(false); }
}

/* ---- Page detection ---- */
const PAGE_SEL = '.slide, .page, section[data-title], [data-page], .reveal .slides > section, .pf';
function findPages(doc) {
  const body = doc.body;
  const cands = [...body.querySelectorAll(PAGE_SEL)].filter(el => !el.parentElement.closest(PAGE_SEL));
  if (cands.length) {
    const groups = new Map();
    cands.forEach(el => { const k = el.parentElement; groups.set(k, [...(groups.get(k) || []), el]); });
    const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    if (best.length >= 2 || cands.length === 1) return { pages: best, single: false };
  }
  // Repeated big blocks (sections/articles/same-class divs), searched a few levels down
  const total = (body.textContent || '').trim().length || 1;
  const skip = el => /^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT|BR)$/.test(el.tagName) ||
    (el.tagName.toLowerCase() === 'svg' && (el.getAttribute('width') === '0' || el.getAttribute('aria-hidden') === 'true'));
  let best = null;
  const visit = (el, depth) => {
    const kids = [...el.children].filter(k => !skip(k));
    const sig = k => k.tagName + '.' + (k.classList[0] || '');
    const counts = new Map();
    kids.forEach(k => {
      if (!/^(SECTION|ARTICLE|DIV|MAIN)$/.test(k.tagName)) return;
      if (k.tagName === 'DIV' && !k.classList.length) return;
      counts.set(sig(k), [...(counts.get(sig(k)) || []), k]);
    });
    for (const group of counts.values()) {
      if (group.length < 2) continue;
      const share = group.reduce((n, k) => n + (k.textContent || '').trim().length, 0) / total;
      if (share >= 0.5 && (!best || share > best.share || (share === best.share && group.length > best.group.length))) best = { group, share };
    }
    if (depth < 3) kids.forEach(k => { if (/^(DIV|MAIN|ARTICLE|SECTION)$/.test(k.tagName)) visit(k, depth + 1); });
  };
  visit(body, 0);
  if (best) return { pages: best.group, single: false };
  return { pages: [body], single: true };
}
const clean = t => (t || '').replace(/\s+/g, ' ').trim();
function pageTitles() {
  // Title = data-title, else the most important heading that isn't a running header repeated on every page
  const els = S.pages.map(sq);
  const seen = new Map();
  els.forEach(el => new Set([...(el?.querySelectorAll('h1, h2, h3, h4') || [])].map(h => clean(h.textContent))).forEach(t => seen.set(t, (seen.get(t) || 0) + 1)));
  return els.map((el, i) => {
    if (!el) return `Page ${i + 1}`;
    const t = el.getAttribute('data-title');
    if (t) return t;
    for (const lvl of ['h1', 'h2', 'h3', 'h4']) {
      const h = [...el.querySelectorAll(lvl)].map(x => clean(x.textContent)).find(x => x && (els.length < 3 ? (seen.get(x) || 0) < 2 : (seen.get(x) || 0) < els.length * 0.6));
      if (h) return h.length > 48 ? h.slice(0, 46) + '…' : h;
    }
    return `Page ${i + 1}`;
  });
}

/* ============================== OPEN / NEW ============================== */
function loadText(text, { name = 'Untitled.html', handle = null, baseHref = null, draftId = null } = {}) {
  if (!text || !text.trim()) { homeError('This file is empty. Choose a file that has a page in it.'); return false; }
  finishEditing(false);
  const m = text.match(/^﻿?\s*(<!doctype[^>]*>)/i);
  S.doctype = m ? m[1] : '<!DOCTYPE html>';
  const g = text.match(/<html\b[^>]*>(\s*)<head\b/i);
  S.htmlGap = g ? g[1] : '';
  S.doc = parse(text);
  S.nextId = 1;
  assignIds(S.doc.body);
  S.orig = null;
  try {
    const spans = mapSpans(S.doc, text);
    const byId = new Map();
    [S.doc.documentElement, ...S.doc.documentElement.querySelectorAll('*')].forEach(el => byId.set(spanKey(el), el.cloneNode(false)));
    S.orig = { text, spans, norm: normMap(S.doc.documentElement), byId };
  } catch (e) { console.warn('Pagewise: could not map source', e); }
  const { pages, single } = findPages(S.doc);
  S.pages = pages.map(idOf); S.single = single; S.cur = 0;
  S.name = name; S.handle = handle; S.baseHref = baseHref;
  S.draftId = draftId || ('d' + Date.now().toString(36));
  S.pageVer = {};
  S.hist = []; S.hi = -1; pushHistory();
  S.dirty = false;
  SEL = null;
  enterEditor();
  return true;
}

const BLANK = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Untitled document</title>
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; background: #eceef1; color: #1d1b20; font-family: Georgia, 'Times New Roman', serif; }
  .page { box-sizing: border-box; width: 210mm; min-height: 297mm; margin: 10mm auto; padding: 24mm 22mm; background: #fff; box-shadow: 0 4px 24px rgb(0 0 0 / .12); }
  h1 { font: 700 34px/1.2 Arial, Helvetica, sans-serif; margin: 0 0 14px; }
  h2 { font: 700 22px/1.3 Arial, Helvetica, sans-serif; margin: 26px 0 8px; }
  h3 { font: 700 17px/1.35 Arial, Helvetica, sans-serif; margin: 20px 0 6px; }
  p, li { font-size: 16px; line-height: 1.6; }
  p { margin: 0 0 12px; }
  blockquote { margin: 16px 0; padding: 4px 0 4px 16px; border-left: 4px solid #bb0055; font-style: italic; }
  img { max-width: 100%; height: auto; }
  @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; break-after: page; } }
</style>
</head>
<body>
<main class="page">
  <h1>Untitled document</h1>
  <p>Click here and start typing.</p>
</main>
</body>
</html>
`;

async function openPicker() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'Web page', accept: { 'text/html': ['.html', '.htm'] } }] });
      await openFile(await h.getFile(), h);
    } catch (e) { if (e.name !== 'AbortError') homeError('That file couldn’t be opened. Try choosing it again.'); }
  } else $('#fileInput').click();
}
async function openFile(file, handle = null) {
  if (!file) return;
  if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') {
    homeError(`“${file.name}” isn’t a web page. Choose a file that ends in .html`);
    return;
  }
  try { loadText(await file.text(), { name: file.name, handle }); }
  catch { homeError(`“${file.name}” couldn’t be read. Try opening it again.`); }
}
async function openUrl(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    const name = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || 'page.html');
    loadText(await r.text(), { name, baseHref: new URL(url, location.href).href });
  } catch { homeError('That link couldn’t be opened. Check the address and try again.'); }
}
function homeError(msg) {
  const el = $('#homeError');
  if (!$('#editor').hidden) { toast(msg); return; }
  el.textContent = msg; el.hidden = !msg;
}

/* ============================== HISTORY ============================== */
function pushHistory() {
  const html = serialize(true);
  const cur = S.hist[S.hi];
  if (cur && cur.html === html) { cur.pages = [...S.pages]; cur.cur = S.cur; return false; }
  S.hist = S.hist.slice(0, S.hi + 1);
  S.hist.push({ html, pages: [...S.pages], cur: S.cur });
  let size = S.hist.reduce((n, h) => n + h.html.length, 0);
  while (S.hist.length > 2 && (S.hist.length > 80 || size > 60e6)) { size -= S.hist.shift().html.length; }
  S.hi = S.hist.length - 1;
  return true;
}
function commit({ structural = false } = {}) {
  const changed = pushHistory();
  updateUndo();
  if (!changed && !structural) return;
  setDirty(true);
  saveDraftSoon();
  placeHandlesSoon();
  if (structural) { S.pages.forEach(id => bumpPage(id)); renderPageList(); }
  else { bumpPage(curId()); updateTitles(); }
  snapshotSoon();
}
function restore(i) {
  finishEditing(false);
  S.hi = i;
  const h = S.hist[i];
  S.doc = parse(h.html);
  S.pages = h.pages.filter(id => sq(id));
  if (!S.pages.length) S.pages = [idOf(S.doc.body)];
  S.cur = clamp(h.cur, 0, S.pages.length - 1);
  S.pages.forEach(bumpPage);
  deselect();
  setDirty(true); saveDraftSoon();
  renderPageList();
  renderView();
  updateUndo();
}
const undo = () => { if (E.el) finishEditing(); if (S.hi > 0) restore(S.hi - 1); };
const redo = () => { if (E.el) finishEditing(); if (S.hi < S.hist.length - 1) restore(S.hi + 1); };
function updateUndo() {
  $('#undoBtn').disabled = !(S.hi > 0 || E.dirty);
  $('#redoBtn').disabled = !(S.hi < S.hist.length - 1);
}

/* ============================== DIRTY / DRAFTS ============================== */
function setDirty(d, label) {
  S.dirty = d;
  const st = $('#docState');
  st.dataset.state = d ? 'dirty' : 'saved';
  $('#docStateText').textContent = label || (d ? 'Unsaved changes' : 'Saved');
}
function setState(state, text) { $('#docState').dataset.state = state; $('#docStateText').textContent = text; }

const DRAFTS = 'pw:drafts';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
function draftsList() { try { return JSON.parse(store.get(DRAFTS) || '[]'); } catch { return []; } }
function saveDraft() {
  if (!S.doc) return;
  const html = serialize(false);
  let list = draftsList().filter(d => d.id !== S.draftId);
  list.unshift({ id: S.draftId, name: S.name, at: Date.now(), pages: S.pages.length, saved: !S.dirty });
  while (list.length > 6) { const old = list.pop(); store.del('pw:draft:' + old.id); }
  if (!store.set('pw:draft:' + S.draftId, html)) {
    // Too big for browser storage: keep the list entry out so we never offer a broken draft.
    list = list.filter(d => d.id !== S.draftId);
  }
  store.set(DRAFTS, JSON.stringify(list));
}
const saveDraftSoon = debounce(saveDraft, 1200);
function removeDraft(id) {
  const list = draftsList(); const item = list.find(d => d.id === id);
  const html = store.get('pw:draft:' + id);
  store.set(DRAFTS, JSON.stringify(list.filter(d => d.id !== id)));
  store.del('pw:draft:' + id);
  renderRecents();
  toast(`Removed ${item?.name || 'draft'}`, { action: 'Undo', onAction: () => {
    if (html) store.set('pw:draft:' + id, html);
    store.set(DRAFTS, JSON.stringify([item, ...draftsList()].filter(Boolean)));
    renderRecents();
  } });
}
function timeAgo(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function renderRecents() {
  const list = draftsList().filter(d => store.get('pw:draft:' + d.id) != null);
  $('#recentSection').hidden = !list.length;
  const box = $('#recentList'); box.innerHTML = '';
  const tones = ['pink', 'blue', 'teal', 'amber', 'violet'];
  list.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'mn-item'; row.dataset.tone = tones[i % tones.length];
    row.innerHTML = `<span class="lead recent-lead"></span><span class="text"><span class="title"></span><span class="sub recent-sub"></span></span><span class="trail"><button class="mn-icon-btn" aria-label="Remove from this list"><i data-icon="close"></i></button></span>`;
    row.querySelector('.lead').textContent = (d.name || '?').trim()[0]?.toUpperCase() || '?';
    row.querySelector('.title').textContent = d.name;
    row.querySelector('.sub').textContent = `${d.pages} ${d.pages === 1 ? 'page' : 'pages'} · edited ${timeAgo(d.at)}${d.saved ? '' : ' · not saved to file'}`;
    row.style.cursor = 'pointer';
    row.addEventListener('click', e => {
      if (e.target.closest('.trail button')) { removeDraft(d.id); return; }
      const html = store.get('pw:draft:' + d.id);
      if (html) { loadText(html, { name: d.name, draftId: d.id }); if (!d.saved) setDirty(true); }
    });
    box.append(row);
  });
  window.mn?.icons && document.querySelectorAll('#recentList [data-icon]').forEach(el => { el.innerHTML = mn.icon(el.dataset.icon); });
}

/* ============================== SAVE / PRESENT ============================== */
function download(html, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function save({ copy = false } = {}) {
  if (E.el) finishEditing();
  const html = faithfulSerialize();
  if (copy) { download(html, S.name); toast(`Downloaded a copy of ${S.name}`); return true; }
  if (S.handle?.createWritable) {
    try {
      setState('saving', 'Saving…');
      if (S.handle.queryPermission && (await S.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        if ((await S.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('permission');
      }
      const w = await S.handle.createWritable();
      await w.write(html); await w.close();
      setDirty(false); saveDraft();
      return true;
    } catch (e) {
      setState('error', 'Not saved');
      toast('Couldn’t save to the file. Download a copy instead?', { action: 'Download', onAction: () => save({ copy: true }) });
      return false;
    }
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: S.name, types: [{ description: 'Web page', accept: { 'text/html': ['.html', '.htm'] } }] });
      S.handle = h; S.name = h.name; $('#docName').textContent = S.name;
      return save();
    } catch (e) { if (e.name === 'AbortError') return false; }
  }
  download(html, S.name);
  setDirty(false, 'Downloaded'); saveDraft();
  toast(`Downloaded ${S.name}. Find it in your Downloads folder`);
  return true;
}
function presentHtml() {
  let html = faithfulSerialize();
  if (S.baseHref && !/<base\s/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${esc(S.baseHref)}">`);
  return html;
}
function present() {
  if (E.el) finishEditing();
  const url = URL.createObjectURL(new Blob([presentHtml()], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  if (!w) toast('Your browser blocked the new tab. Allow pop-ups for this page and try again');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function printDoc() {
  if (E.el) finishEditing();
  const url = URL.createObjectURL(new Blob([presentHtml()], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  if (!w) { toast('Your browser blocked the new tab. Allow pop-ups for this page and try again'); return; }
  w.addEventListener('load', () => setTimeout(() => w.print(), 600));
}

/* ============================== VIEW (iframe) ============================== */
function viewCSS() {
  const sel = token('--acc-select') || 'Highlight';
  const hov = token('--acc-blue') || 'Highlight';
  return `
html[data-wy-ready] [data-wy-page]:not([data-wy-current]),html[data-wy-ready] [data-wy-chrome]{display:none!important}
[data-wy-current]{opacity:1!important;visibility:visible!important;pointer-events:auto!important;transform:none!important;translate:none!important;scale:none!important}
[data-wy-current] .reveal,[data-wy-current] .build,[data-wy-current] .fragment{opacity:1!important;visibility:visible!important;transform:none!important;translate:none!important}
[data-wy-current] .draw{stroke-dashoffset:0!important}
[data-wy-current],[data-wy-current] *{transition:none!important}
[data-wy-hover]{outline:2px dashed ${hov}!important;outline-offset:2px!important}
[data-wy-sel]{outline:3px solid ${sel}!important;outline-offset:3px!important}
[data-wy-edit]{outline:3px solid ${sel}!important;outline-offset:3px!important;cursor:text!important;user-select:text!important;-webkit-user-select:text!important}
svg [data-wy-hover],svg[data-wy-hover]{outline:none!important;filter:drop-shadow(0 0 1.5px ${hov}) drop-shadow(0 0 1.5px ${hov})}
svg [data-wy-sel],svg[data-wy-sel]{outline:none!important;filter:drop-shadow(0 0 2px ${sel}) drop-shadow(0 0 2px ${sel})}
img[data-wy-hover]{cursor:pointer}
`;
}
function buildViewHTML(gen) {
  const root = S.doc.documentElement.cloneNode(true);
  const q = id => root.getAttribute('data-wy') === id ? root : root.querySelector(`[data-wy="${cssEsc(id)}"]`);
  S.pages.forEach(id => q(id)?.setAttribute('data-wy-page', ''));
  const cur = q(curId());
  if (cur) { cur.setAttribute('data-wy-current', ''); if (cur.classList.contains('slide')) cur.classList.add('is-active'); }
  let head = root.querySelector('head');
  if (!head) { head = S.doc.createElement('head'); root.prepend(head); }
  const boot = S.doc.createElement('script');
  boot.setAttribute('data-pw', '');
  boot.textContent = `(function(){var G=${gen};['pointerdown','pointerup','pointermove','mousedown','mouseup','mousemove','click','dblclick','auxclick','contextmenu','keydown','keyup','keypress','wheel','touchstart','touchmove','touchend','dragstart','dragover','drop','paste','input','beforeinput','focusin','submit'].forEach(function(t){window.addEventListener(t,function(e){var b;try{b=parent.__pagewise}catch(x){}if(b)b(e,G)},{capture:true,passive:false})})})();`;
  head.prepend(boot);
  if (S.baseHref && !head.querySelector('base')) {
    const base = S.doc.createElement('base'); base.setAttribute('href', S.baseHref); head.prepend(base);
  }
  const st = S.doc.createElement('style'); st.setAttribute('data-pw', ''); st.textContent = viewCSS();
  head.append(st);
  return (S.doc.doctype ? (S.doctype || '<!DOCTYPE html>') + '\n' : '') + root.outerHTML;
}
let loadTimer;
function renderView(after) {
  V.ready = false;
  const gen = ++V.gen;
  const f = $('#view');
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => { if (!V.ready) $('#canvasLoading').hidden = false; }, 300);
  f.onload = () => {
    if (gen !== V.gen) return;
    V.win = f.contentWindow; V.doc = f.contentDocument;
    V.doc.addEventListener('selectionchange', onSelectionChange);
    V.win.addEventListener('scroll', placeHandlesSoon, true);
    V.win.addEventListener('resize', placeHandlesSoon);
    // Let the page's own scripts measure the full layout first, then show only the current page.
    const reveal = () => {
      if (gen !== V.gen) return;
      V.doc.documentElement.setAttribute('data-wy-ready', '');
      V.ready = true;
      clearTimeout(loadTimer); $('#canvasLoading').hidden = true;
      f.style.opacity = '';
      setCurrentInView();
      fit();
      updatePageNav();
      setTimeout(() => { if (gen === V.gen) { setCurrentInView(); fit(); snapshot(); } }, 600);
      after?.();
    };
    V.win.requestAnimationFrame(() => V.win.requestAnimationFrame(() => setTimeout(reveal, 120)));
  };
  f.style.opacity = '0';
  fitFrameToWrap();
  f.srcdoc = buildViewHTML(gen);
}
function fitFrameToWrap() {
  const wrap = $('#frameWrap'), f = $('#view');
  f.style.width = wrap.clientWidth + 'px'; f.style.height = wrap.clientHeight + 'px'; f.style.transform = '';
  V.scale = 1;
}
function fit() {
  const wrap = $('#frameWrap'), f = $('#view');
  const cw = wrap.clientWidth, ch = wrap.clientHeight;
  if (!cw || !ch) return;
  if (!V.ready) { fitFrameToWrap(); return; }
  // Pages with a fixed design width (A4 sheets, 1120px slides) that are wider than the canvas
  // are shown zoomed out. Layout width (offsetWidth) ignores the page's own scaling transforms,
  // so a deck that scales itself to the window can't feed back into this.
  const page = curViewEl();
  const natural = page && page !== V.doc.body ? page.offsetWidth : V.doc.documentElement.scrollWidth;
  let s = 1;
  if (natural > cw) s = cw / (natural + (page && page !== V.doc.body ? 32 : 0));
  s = Math.max(s, 0.2);
  // "Real size" zoom: show the page at 100% and let it scroll sideways (handy on phones)
  const zoomable = s < 0.9;
  $('#zoomBtn').hidden = !zoomable;
  $('#zoomBtn').setAttribute('aria-pressed', String(zoomable && V.zoom));
  $('#zoomBtn').setAttribute('aria-label', V.zoom ? 'Fit page to screen' : 'Show at real size');
  $('#zoomBtn').title = $('#zoomBtn').getAttribute('aria-label');
  $('#zoomBtn path').setAttribute('d', 'M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.49 4.49 0 0 1 9.5 14Z' + (V.zoom ? 'M7 9h5v1H7Z' : 'M10 7H9v2H7v1h2v2h1v-2h2V9h-2Z'));
  if (zoomable && V.zoom) s = 1;
  f.style.width = (cw / s) + 'px';
  f.style.height = (ch / s) + 'px';
  f.style.transform = s === 1 ? '' : `scale(${s})`;
  V.scale = s;
}
const fitSoon = debounce(() => { fit(); snapshotSoon(); }, 120);

function setCurrentInView() {
  if (!V.doc) return;
  V.doc.querySelectorAll('[data-wy-current]').forEach(el => {
    el.removeAttribute('data-wy-current');
    if (el.classList.contains('slide') && el.dataset.pwActive) { el.classList.remove('is-active'); delete el.dataset.pwActive; }
  });
  S.pages.forEach(id => vqa(id).forEach(el => el.setAttribute('data-wy-page', '')));
  if (!S.single) [...V.doc.body.children].forEach(c => { if (!idOf(c) && !c.hasAttribute('data-pw-ui') && !/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(c.tagName)) c.setAttribute('data-wy-chrome', ''); });
  const el = curViewEl();
  if (el) {
    el.inert = false; el.removeAttribute('aria-hidden');
    el.querySelectorAll('[inert]').forEach(x => { x.inert = false; });
    el.setAttribute('data-wy-current', '');
    if (el.classList.contains('slide') && !el.classList.contains('is-active')) { el.classList.add('is-active'); el.dataset.pwActive = '1'; }
  }
}

/* ============================== PAGES ============================== */
function goPage(i, { anim = true } = {}) {
  i = clamp(i, 0, S.pages.length - 1);
  if (i === S.cur) return;
  if (E.el) finishEditing();
  deselect();
  const fwd = i > S.cur;
  S.cur = i;
  const apply = () => {
    setCurrentInView();
    markCurrentInList();
    updatePageNav();
    fit();
    try { V.win?.scrollTo(0, 0); } catch {}
  };
  if (anim && window.mn) mn.go(apply, { type: fwd ? 'forward' : 'back' }); else apply();
}
function updatePageNav() {
  $('#pageNum').textContent = `Page ${S.cur + 1} of ${S.pages.length}`;
  $('#prevPage').disabled = S.cur === 0;
  $('#nextPage').disabled = S.cur >= S.pages.length - 1;
  $('#pageCount').textContent = S.pages.length;
  $('#pageHint').hidden = !S.single;
  $$('[data-page]').forEach(b => {
    const a = b.dataset.page;
    b.disabled = S.single && a !== 'bg' ||
      (a === 'up' && S.cur === 0) || (a === 'down' && S.cur >= S.pages.length - 1) ||
      (a === 'del' && S.pages.length < 2);
  });
}
function bumpPage(id) { S.pageVer[id] = (S.pageVer[id] || 0) + 1; }

let io;
function renderPageList() {
  const ol = $('#pageList');
  ol.innerHTML = '';
  io?.disconnect();
  io = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) renderThumb(en.target); }), { root: ol, rootMargin: '200px' });
  const titles = pageTitles();
  S.pages.forEach((id, i) => {
    const li = document.createElement('li');
    li.className = 'pg'; li.dataset.id = id; li.draggable = !S.single;
    li.tabIndex = 0; li.setAttribute('role', 'button');
    li.setAttribute('aria-current', i === S.cur ? 'true' : 'false');
    li.innerHTML = `<span class="num">${i + 1}</span><div class="thumb"><div class="ph mn-skeleton"></div></div><span class="title"></span>`;
    li.querySelector('.title').textContent = titles[i];
    li.title = li.querySelector('.title').textContent;
    li.querySelector('.thumb').style.height = (thumbW() * 0.62) + 'px';
    ol.append(li);
    io.observe(li);
  });
  updatePageNav();
}
function markCurrentInList() {
  $$('#pageList .pg').forEach((li, i) => li.setAttribute('aria-current', i === S.cur ? 'true' : 'false'));
  $('#pageList .pg[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function updateTitles() {
  const titles = pageTitles();
  $$('#pageList .pg').forEach((li, i) => { const t = titles[i] || `Page ${i + 1}`; li.querySelector('.title').textContent = t; li.title = t; });
}
const thumbW = () => matchMedia('(max-width: 839px)').matches ? 104 : 170;

/* ---- Thumbnails: static copies of the live view, one per page ---- */
const TH = { base: null, w: 0, h: 0 };
function snapshot() {
  if (!V.ready) return;
  const root = V.doc.documentElement.cloneNode(true);
  root.querySelectorAll('script, style[data-pw], [data-pw-ui]').forEach(s => s.remove());
  root.querySelectorAll('[data-wy-current]').forEach(e => e.removeAttribute('data-wy-current'));
  root.querySelectorAll('[data-wy-chrome]').forEach(e => e.remove());
  root.querySelectorAll('[inert]').forEach(e => e.removeAttribute('inert'));
  EDITOR_ATTRS.forEach(a => root.querySelectorAll(`[${a}]`).forEach(e => e.removeAttribute(a)));
  TH.base = root.outerHTML;
  const f = $('#view');
  TH.w = parseFloat(f.style.width) || f.clientWidth;
  TH.h = parseFloat(f.style.height) || f.clientHeight;
  $$('#pageList .pg').forEach(li => {
    if (li.dataset.v !== String(S.pageVer[li.dataset.id] || 0)) {
      const r = li.getBoundingClientRect(), pr = $('#pageList').getBoundingClientRect();
      if (r.bottom > pr.top - 200 && r.top < pr.bottom + 200 && r.right > pr.left - 200 && r.left < pr.right + 200) renderThumb(li);
    }
  });
}
const snapshotSoon = debounce(snapshot, 700);
function renderThumb(li) {
  if (!TH.base) return;
  const id = li.dataset.id, ver = String(S.pageVer[id] || 0);
  if (li.dataset.v === ver) return;
  li.dataset.v = ver;
  const box = li.querySelector('.thumb');
  const fresh = document.createElement('iframe');
  fresh.setAttribute('sandbox', 'allow-same-origin');
  fresh.setAttribute('aria-hidden', 'true'); fresh.tabIndex = -1;
  fresh.style.width = TH.w + 'px'; fresh.style.height = TH.h + 'px';
  fresh.style.visibility = 'hidden';
  const css = `[data-wy-page]:not([data-wy="${id}"]){display:none!important}
[data-wy="${id}"]{opacity:1!important;visibility:visible!important;transform:none!important;translate:none!important}
[data-wy="${id}"] .reveal,[data-wy="${id}"] .build,[data-wy="${id}"] .fragment{opacity:1!important;visibility:visible!important;transform:none!important}
[data-wy="${id}"] .draw{stroke-dashoffset:0!important}
*,*::before,*::after{transition:none!important;animation:none!important}
html,body{overflow:hidden!important}`;
  fresh.onload = () => {
    const d = fresh.contentDocument; if (!d) return;
    const el = d.querySelector(`[data-wy="${cssEsc(id)}"]`);
    let r;
    if (!el || el === d.body) {
      const w = d.documentElement.scrollWidth;
      r = { left: 0, top: 0, width: w, height: Math.min(d.documentElement.scrollHeight, w * 1.3) };
    } else r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (r.top + r.height > TH.h) fresh.style.height = (r.top + r.height + 4) + 'px';
    const tw = box.clientWidth || thumbW();
    const s = tw / r.width;
    box.style.height = clamp(r.height * s, 36, tw * (thumbW() < 150 ? 1.1 : 1.6)) + 'px';
    fresh.style.transform = `scale(${s}) translate(${-r.left}px, ${-r.top}px)`;
    fresh.style.visibility = '';
    box.querySelector('.ph')?.remove();
    box.querySelectorAll('iframe').forEach(x => { if (x !== fresh) x.remove(); });
  };
  box.append(fresh);
  fresh.srcdoc = (S.doc.doctype ? S.doctype + '\n' : '') + TH.base.replace(/<\/head>/i, `<style>${css}</style></head>`);
}

/* ---- Page operations ---- */
function remapClone(srcClone, viewEl) {
  // Give a cloned source subtree fresh ids; return a view clone with the same ids.
  const map = new Map();
  const all = [srcClone, ...srcClone.querySelectorAll('[data-wy]')];
  all.forEach(el => { const n = newId(); map.set(idOf(el), n); el.setAttribute('data-wy', n); });
  if (!viewEl) return { map, view: null };
  const vc = viewEl.cloneNode(true);
  [vc, ...vc.querySelectorAll('[data-wy]')].forEach(el => {
    const n = map.get(idOf(el));
    if (n) el.setAttribute('data-wy', n); else el.removeAttribute('data-wy');
  });
  EDITOR_ATTRS.concat('data-wy-current').forEach(a => { vc.removeAttribute(a); vc.querySelectorAll(`[${a}]`).forEach(e => e.removeAttribute(a)); });
  return { map, view: vc };
}
function chainClone(page, target, text) {
  // Clone the wrappers from page down to target (shallow), so a new page keeps the same look.
  const chain = []; let x = target;
  while (x && x !== page) { chain.unshift(x); x = x.parentElement; }
  if (x !== page) return null;
  const top = chain[0].cloneNode(false);
  let p = top;
  for (let i = 1; i < chain.length; i++) { const c = chain[i].cloneNode(false); p.append(c); p = c; }
  p.textContent = text;
  return top;
}
function pageOp(op) {
  if (S.single && op !== 'bg') return;
  if (E.el) finishEditing();
  deselect();
  const id = curId(), src = sq(id), view = curViewEl();
  if (!src) return;
  if (op === 'dup' || op === 'add') {
    let clone;
    if (op === 'dup') clone = src.cloneNode(true);
    else {
      // Template: the current page, unless it is the cover (first) page and others exist
      const tpl = (S.cur === 0 && S.pages.length > 1) ? sq(S.pages[1]) || src : src;
      clone = tpl.cloneNode(false);
      clone.removeAttribute('id');
      if (S.pages.length > 1) {
        // Classes used by only one page are that page's own layout; leave them off
        const count = new Map();
        S.pages.forEach(pid => sq(pid)?.classList.forEach(c => count.set(c, (count.get(c) || 0) + 1)));
        [...clone.classList].forEach(c => { if ((count.get(c) || 0) < 2) clone.classList.remove(c); });
      }
      const h = tpl.querySelector('h2') || tpl.querySelector('h1, h3');
      const p = [...tpl.querySelectorAll('p, li')].find(el => (el.textContent || '').trim().length > 0 && !(h && h.contains(el)));
      const hc = h ? chainClone(tpl, h, 'New page') : null;
      const pc = p ? chainClone(tpl, p, 'Click here and start typing') : null;
      [hc, pc].forEach(x => x && [x, ...x.querySelectorAll('[id]')].forEach(e => e.removeAttribute('id')));
      if (hc) clone.append(hc); else { const h2 = S.doc.createElement('h2'); h2.textContent = 'New page'; clone.append(h2); }
      if (pc) clone.append(pc); else { const pp = S.doc.createElement('p'); pp.textContent = 'Click here and start typing'; clone.append(pp); }
      if (clone.hasAttribute('data-title')) clone.setAttribute('data-title', 'New page');
    }
    if (op === 'dup' && clone.hasAttribute('data-title')) clone.setAttribute('data-title', clone.getAttribute('data-title') + ' (copy)');
    const { view: vc } = remapClone(clone, op === 'dup' ? view : null);
    src.after(clone);
    let vEl = vc;
    if (!vEl) { vEl = V.doc.importNode(clone, true); }
    vEl.removeAttribute('data-wy-current');
    if (vEl.dataset?.pwActive) { vEl.classList.remove('is-active'); delete vEl.dataset.pwActive; }
    view?.after(vEl);
    const nid = idOf(clone);
    S.pages.splice(S.cur + 1, 0, nid);
    bumpPage(nid);
    renderPageList();
    goPage(S.cur + 1);
    commit({ structural: true });
    toast(op === 'dup' ? `Page ${S.cur + 1} is a copy of page ${S.cur}` : `Added page ${S.cur + 1}`);
    return;
  }
  if (op === 'del') {
    if (S.pages.length < 2) { toast('A document needs at least one page'); return; }
    const n = S.cur + 1;
    src.remove(); vqa(id).forEach(v => v.remove());
    S.pages.splice(S.cur, 1);
    S.cur = clamp(S.cur, 0, S.pages.length - 1);
    setCurrentInView();
    renderPageList(); fit();
    commit({ structural: true });
    toast(`Deleted page ${n}`, { action: 'Undo', onAction: undo });
    return;
  }
  if (op === 'up' || op === 'down') movePage(S.cur, op === 'up' ? S.cur - 1 : S.cur + 1);
}
function movePage(from, to) {
  if (to < 0 || to >= S.pages.length || from === to) return;
  const id = S.pages[from], other = S.pages[to];
  const s = sq(id), o = sq(other);
  if (!s || !o) return;
  if (to < from) { o.before(s); const v = vq(id), vo = vq(other); if (v && vo) vo.before(v); }
  else { o.after(s); const v = vq(id), vo = vq(other); if (v && vo) vo.after(v); }
  S.pages.splice(from, 1); S.pages.splice(to, 0, id);
  S.cur = to;
  renderPageList();
  setCurrentInView(); updatePageNav();
  commit({ structural: true });
}

/* ============================== VIEW EVENTS ============================== */
window.__pagewise = (e, gen) => {
  if (gen !== V.gen || !V.ready) { try { e.stopImmediatePropagation(); } catch {} return; }
  e.stopImmediatePropagation();
  const h = VH[e.type];
  if (h) h(e);
};
const elOf = n => n && (n.nodeType === 1 ? n : n.parentElement);
function isTextBlock(el) {
  if (!el || el.nodeType !== 1 || !idOf(el)) return false;
  if (el.closest('svg')) return false;
  const tag = el.tagName.toLowerCase();
  if (NEVER_TEXT.has(tag) || S.pages.includes(idOf(el))) return false;
  for (const d of el.querySelectorAll('*')) {
    const own = d.closest('svg');
    if (own && own !== d) continue;                 // svg internals belong to an inline svg icon
    if (!INLINE.has(d.tagName.toLowerCase())) return false;
  }
  return (el.textContent || '').trim().length > 0 || EMPTY_OK.has(tag);
}
function textBlockFor(t) {
  let el = t.closest('svg') ? t.closest('svg').parentElement : t;
  let best = null;
  while (el && el !== V.doc.body && el !== V.doc.documentElement) {
    if (isTextBlock(el)) best = el;
    else if (best || !INLINE.has(el.tagName.toLowerCase())) break;
    if (S.pages.includes(idOf(el))) break;
    el = el.parentElement;
  }
  return best;
}
function boxFor(t) {
  let el = t.closest('svg') || t;
  while (el && el !== V.doc.body && el !== V.doc.documentElement) {
    const tag = el.tagName.toLowerCase();
    if (S.pages.includes(idOf(el))) return null;
    if (idOf(el) && (!INLINE.has(tag) || tag === 'svg' || tag === 'img')) return el;
    el = el.parentElement;
  }
  return null;
}
function inCurrentPage(t) {
  const page = curViewEl();
  return !!page && (page === V.doc.body || page.contains(t));
}
function hit(t) {
  t = elOf(t);
  if (!t || !inCurrentPage(t)) return null;
  const svgText = t.closest('text, tspan, textPath');
  if (svgText && svgText.closest('svg')) {
    const target = (svgText.tagName.toLowerCase() === 'tspan' && idOf(svgText)) ? svgText : (svgText.closest('text') || svgText);
    if (idOf(target)) return { kind: 'label', el: target };
  }
  if (t.tagName === 'IMG' && idOf(t)) return { kind: 'pic', el: t };
  const tb = textBlockFor(t);
  if (tb) return { kind: 'text', el: tb };
  const box = boxFor(t);
  if (box) return { kind: box.tagName === 'IMG' ? 'pic' : 'box', el: box };
  return null;
}

let hoverEl = null;
function setHover(el) {
  if (hoverEl === el) return;
  hoverEl?.removeAttribute('data-wy-hover');
  hoverEl = el;
  if (el && el !== E.el && !(SEL?.all || []).includes(el)) el.setAttribute('data-wy-hover', '');
}
function tapAt(t, e) {
  const h = hit(t);
  // Shift/Ctrl/Cmd+click (or "Select several") adds boxes and pictures to the selection
  const add = (e.shiftKey || e.metaKey || e.ctrlKey || V.multi) && h && h.kind !== 'label' && (SEL || E.el);
  if (V.multi && h && h.kind !== 'label' && !SEL && !E.el) { select(h.kind === 'text' ? 'box' : h.kind, h.el); return; }
  if (add) {
    e.preventDefault?.();
    if (E.el) { const a = E.el; finishEditing(); select('box', a); }
    select(h.kind === 'text' ? 'box' : h.kind, h.el, { add: true });
    return;
  }
  if (E.el) finishEditing();
  setHover(null);
  if (!h) { deselect(); return; }
  if (h.kind === 'text') startEditing(h.el, e);
  else { if (h.kind === 'pic') e.preventDefault(); select(h.kind, h.el); }
}
/* ---- Resize handles: drag the right edge, bottom edge or corner of the selected thing ----
   The handles live in an editor-only layer inside the view ([data-pw-ui]); they are never saved. */
const SIZE_PROPS = ['width', 'height', 'min-height', 'max-width', 'flex'];
let RZ = null;
function resizeTarget() {
  const el = SEL?.kind === 'pic' || SEL?.kind === 'box' ? SEL.el : E.el;
  if (!el || !V.doc || !el.isConnected) return null;
  const tag = el.tagName.toLowerCase();
  if (el.closest('svg') && tag !== 'svg') return null;
  if (/^(td|th|tr|li|tbody|thead|body|html)$/.test(tag) || S.pages.includes(idOf(el))) return null;
  if (INLINE.has(tag) && tag !== 'img' && tag !== 'svg') return null;
  return el;
}
function handleLayer() {
  let ui = V.doc.querySelector('[data-pw-ui]');
  if (!ui) {
    ui = V.doc.createElement('div');
    ui.setAttribute('data-pw-ui', '');
    const acc = token('--acc-select') || 'Highlight', on = token('--md-sys-color-surface') || 'white';
    const size = matchMedia('(pointer: coarse)').matches ? 22 : 12;
    ui.innerHTML = ['e', 's', 'se'].map(d => `<span data-pw-handle="${d}"></span>`).join('') + '<b data-pw-size></b>';
    ui.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;display:none';
    ui.querySelectorAll('[data-pw-handle]').forEach(h => {
      const d = h.dataset.pwHandle;
      h.style.cssText = `position:absolute;width:${size}px;height:${size}px;box-sizing:border-box;border:2px solid ${on};background:${acc};border-radius:${d === 'se' ? '50%' : '4px'};pointer-events:auto;touch-action:none;box-shadow:0 1px 4px rgb(0 0 0/.35);cursor:${d === 'e' ? 'ew-resize' : d === 's' ? 'ns-resize' : 'nwse-resize'};` +
        (d === 'e' ? `right:${-size / 2}px;top:calc(50% - ${size / 2}px);` : d === 's' ? `bottom:${-size / 2}px;left:calc(50% - ${size / 2}px);` : `right:${-size / 2}px;bottom:${-size / 2}px;`);
    });
    const lab = ui.querySelector('[data-pw-size]');
    lab.style.cssText = `position:absolute;right:0;top:calc(100% + 14px);padding:3px 8px;border-radius:6px;background:${acc};color:${on};font:600 12px/16px system-ui,sans-serif;white-space:nowrap;display:none`;
    V.doc.body.append(ui);
  }
  return ui;
}
function placeHandles() {
  if (!V.ready || !V.doc?.body) return;
  const el = resizeTarget();
  const ui = handleLayer();
  if (!el || RZ?.el && RZ.el !== el) { ui.style.display = 'none'; return; }
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) { ui.style.display = 'none'; return; }
  Object.assign(ui.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  // Images keep their shape: only the corner and right edge
  ui.querySelector('[data-pw-handle="s"]').style.display = el.tagName === 'IMG' ? 'none' : '';
}
const placeHandlesSoon = () => requestAnimationFrame(placeHandles);
function startResize(dir, e, handle) {
  const el = resizeTarget(); if (!el) return;
  const cs = V.win.getComputedStyle(el), r = el.getBoundingClientRect();
  const boxW = el.offsetWidth || parseFloat(cs.width) || r.width;
  const boxH = el.offsetHeight || parseFloat(cs.height) || r.height;
  RZ = {
    el, dir, x: e.clientX, y: e.clientY,
    ratio: r.width / boxW || 1,
    w: parseFloat(cs.width) || boxW, h: parseFloat(cs.height) || boxH,
    aspect: boxH / boxW, maxW: cs.maxWidth,
    img: el.tagName === 'IMG',
    flexRow: /flex/.test(V.win.getComputedStyle(el.parentElement || el).display) && !/column/.test(V.win.getComputedStyle(el.parentElement || el).flexDirection),
  };
  try { handle.setPointerCapture(e.pointerId); } catch {}
  handleLayer().querySelector('[data-pw-size]').style.display = 'block';
  e.preventDefault();
}
function moveResize(e) {
  const R = RZ; if (!R) return;
  const dx = (e.clientX - R.x) / R.ratio, dy = (e.clientY - R.y) / R.ratio;
  const st = R.el.style;
  let w = R.w, h = null;
  if (R.dir !== 's') w = Math.max(24, Math.round(R.w + dx));
  if (R.img) {
    st.width = w + 'px'; st.height = 'auto';
    if (R.maxW !== 'none' && w > R.w) st.maxWidth = 'none';
    h = Math.round(w * R.aspect);
  } else {
    if (R.dir !== 's') { st.width = w + 'px'; if (R.maxW !== 'none') st.maxWidth = 'none'; if (R.flexRow) st.flex = '0 0 auto'; }
    if (R.dir !== 'e') { h = Math.max(16, Math.round(R.h + dy)); st.minHeight = h + 'px'; }
  }
  const lab = handleLayer().querySelector('[data-pw-size]');
  lab.textContent = h ? `${w} × ${h}` : `${w} wide`;
  placeHandles();
}
function endResize() {
  const R = RZ; RZ = null; if (!R) return;
  handleLayer().querySelector('[data-pw-size]').style.display = 'none';
  R.el.removeAttribute('width'); R.el.removeAttribute('height');
  const id = idOf(R.el), src = sq(id);
  if (src) {
    if (R.img) { src.removeAttribute('width'); src.removeAttribute('height'); }
    SIZE_PROPS.forEach(p => { const v = R.el.style.getPropertyValue(p); if (v) src.style.setProperty(p, v); });
  }
  commit();
  placeHandles();
}
function resetSize() {
  const els = E.el ? [E.el] : (SEL?.all || []);
  if (!els.length) { toast('Select a picture or box first'); return; }
  els.forEach(el => mirror(idOf(el), x => { SIZE_PROPS.forEach(p => x.style.removeProperty(p)); if (!x.getAttribute('style')) x.removeAttribute('style'); }));
  commit(); placeHandlesSoon();
}

const VH = {
  pointermove(e) {
    if (RZ) { moveResize(e); return; }
    if (e.buttons) return;
    const h = hit(e.target);
    setHover(h ? h.el : null);
  },
  pointerdown(e) {
    if (e.button !== 0) return;
    const t = elOf(e.target);
    const handle = t?.closest?.('[data-pw-handle]');
    if (handle) { startResize(handle.dataset.pwHandle, e, handle); return; }
    if (E.el && E.el.contains(t)) return;
    // On touch screens act on a tap (pointerup), so dragging to scroll never starts editing
    if (e.pointerType === 'touch' || e.pointerType === 'pen') { V.touch = { x: e.clientX, y: e.clientY, t: e.timeStamp }; return; }
    tapAt(t, e);
  },
  pointerup(e) {
    if (RZ) { endResize(); return; }
    const T = V.touch; V.touch = null;
    if (!T) return;
    const dx = e.clientX - T.x, dy = e.clientY - T.y;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { const t = elOf(e.target); if (!(E.el && E.el.contains(t))) tapAt(t, e); return; }
    // Horizontal swipe changes page (when not editing text)
    if (!E.el && Math.abs(dx) > 70 && Math.abs(dy) < 50 && e.timeStamp - T.t < 600) goPage(S.cur + (dx < 0 ? 1 : -1));
  },
  pointercancel() { V.touch = null; if (RZ) endResize(); },
  mousedown(e) {
    const t = elOf(e.target);
    if (t?.tagName === 'IMG') e.preventDefault();
  },
  click(e) {
    const t = elOf(e.target);
    if (t?.closest('a, button, input, select, textarea, label, summary, area, [onclick]')) e.preventDefault();
  },
  dblclick(e) {
    const t = elOf(e.target);
    if (SEL?.kind === 'pic' && SEL.el === t) picOp('replace');
  },
  submit(e) { e.preventDefault(); },
  dragstart(e) { if (!(E.el && E.el.contains(elOf(e.target)))) e.preventDefault(); },
  dragover(e) { e.preventDefault(); },
  drop(e) {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    const img = files.find(f => f.type.startsWith('image/'));
    if (!img) return;
    const h = hit(elOf(e.target));
    if (h?.kind === 'pic') { select('pic', h.el); replacePicture(img); }
    else insertPicture(img);
  },
  paste(e) {
    if (!E.el) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text) {
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      if (lines.length === 1) V.doc.execCommand('insertText', false, text);
      else V.doc.execCommand('insertHTML', false, lines.map(esc).join('<br>'));
      markDirty();
    }
  },
  beforeinput(e) {
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); e.inputType === 'historyUndo' ? undo() : redo(); }
  },
  input(e) { if (E.el && E.el.contains(elOf(e.target))) markDirty(); },
  keydown(e) { onKey(e, true); },
};

function onKey(e, inView) {
  const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 's') { e.preventDefault(); save(); return; }
  if (mod && k === 'k') { e.preventDefault(); openLink(); return; }
  if (E.el && inView) {
    if (mod && (k === 'b' || k === 'i' || k === 'u')) { e.preventDefault(); cmd({ b: 'bold', i: 'italic', u: 'underline' }[k]); return; }
    if (k === 'escape') { const el = E.el; finishEditing(); select('box', el); return; }
    if (k === 'enter') { e.preventDefault(); onEnter(e.shiftKey); return; }
    if (k === 'tab') { e.preventDefault(); return; }
    return;
  }
  if (SEL && (k === 'delete' || k === 'backspace')) { e.preventDefault(); boxOp('del'); return; }
  if (SEL && k === 'enter' && SEL.kind === 'box' && isTextBlock(SEL.el)) { e.preventDefault(); startEditing(SEL.el); return; }
  if (k === 'escape') { deselect(); return; }
  if (!mod && (k === 'pagedown' || (k === 'arrowright' && inView !== 'input'))) { e.preventDefault(); goPage(S.cur + 1); return; }
  if (!mod && (k === 'pageup' || (k === 'arrowleft' && inView !== 'input'))) { e.preventDefault(); goPage(S.cur - 1); return; }
}

/* ============================== TEXT EDITING ============================== */
function attrsOf(el) { const o = {}; for (const a of el.attributes) o[a.name] = a.value; return o; }
function snapAttrs(el) {
  const m = new Map();
  el.querySelectorAll('[data-wy]').forEach(d => m.set(idOf(d), attrsOf(d)));
  return m;
}
function startEditing(el, ev) {
  if (!el) return;
  deselect();
  if (vqa(idOf(el)).length > 1 || !sq(idOf(el))) {
    toast('This part is made by the page’s own code, so it can’t be changed here');
    return;
  }
  E.el = el; E.dirty = false; E.start = snapAttrs(el);
  el.setAttribute('contenteditable', 'true');
  el.setAttribute('data-wy-edit', '');
  el.setAttribute('spellcheck', 'true');
  showTab('text');
  updateContextTabs();
  window.mn?.done('click-text');
  const place = () => {
    if (E.el !== el) return;
    if (V.doc.activeElement !== el) el.focus({ preventScroll: true });
    const s = V.win.getSelection();
    if (ev && (!s.rangeCount || !el.contains(s.anchorNode))) {
      let r = null;
      if (V.doc.caretPositionFromPoint) {
        const p = V.doc.caretPositionFromPoint(ev.clientX, ev.clientY);
        if (p) { r = V.doc.createRange(); r.setStart(p.offsetNode, p.offset); }
      } else if (V.doc.caretRangeFromPoint) r = V.doc.caretRangeFromPoint(ev.clientX, ev.clientY);
      if (r && el.contains(r.startContainer)) { r.collapse(true); s.removeAllRanges(); s.addRange(r); }
    }
    if (!ev && (!s.rangeCount || !el.contains(s.anchorNode))) {
      const r = V.doc.createRange(); r.selectNodeContents(el); r.collapse(false); s.removeAllRanges(); s.addRange(r);
    }
    saveRange(); updateToolbar();
  };
  if (ev) setTimeout(place, 0); else place();
}
function selectAllIn(el) {
  const s = V.win.getSelection(), r = V.doc.createRange();
  r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); saveRange();
}
function flush() {
  if (!E.el || !E.dirty) return false;
  const el = E.el, id = idOf(el), src = sq(id);
  if (!src) { E.dirty = false; return false; }
  const clone = el.cloneNode(true);
  clone.querySelectorAll('[data-wy]').forEach(d => {
    const did = idOf(d), s = sq(did), start = E.start?.get(did);
    if (!s || !start) return;
    const now = attrsOf(d), orig = attrsOf(s);
    const names = new Set([...Object.keys(now), ...Object.keys(start), ...Object.keys(orig)]);
    names.forEach(n => {
      if (n === 'data-wy') return;
      const val = now[n] !== start[n] ? now[n] : orig[n];
      if (val == null) d.removeAttribute(n); else d.setAttribute(n, val);
    });
  });
  EDITOR_ATTRS.forEach(a => clone.querySelectorAll(`[${a}]`).forEach(x => x.removeAttribute(a)));
  src.innerHTML = clone.innerHTML;
  const a = [...src.querySelectorAll('*')], b = [...el.querySelectorAll('*')];
  if (a.length === b.length) a.forEach((x, i) => { if (!idOf(x)) { const n = newId(); x.setAttribute('data-wy', n); b[i].setAttribute('data-wy', n); } });
  else a.forEach(x => { if (!idOf(x)) x.setAttribute('data-wy', newId()); });
  E.start = snapAttrs(el);
  E.dirty = false;
  // A page we created ("New page" / "… (copy)") takes its name from its heading once it is typed
  const page = sq(curId());
  const dt = page?.getAttribute('data-title');
  if (dt && (dt === 'New page' || dt.endsWith(' (copy)')) && /^H[1-3]$/.test(src.tagName) && page.querySelector('h1, h2, h3') === src) {
    const t = clean(src.textContent);
    if (t) mirror(curId(), x => x.setAttribute('data-title', t));
  }
  return true;
}
const flushSoon = debounce(() => { if (flush()) commit(); }, 900);
function markDirty() {
  if (!E.el) return;
  E.dirty = true;
  setDirty(true);
  placeHandlesSoon();
  $('#undoBtn').disabled = false;
  flushSoon();
}
function finishEditing(doCommit = true) {
  if (!E.el) return;
  flushSoon.cancel();
  const el = E.el;
  const changed = flush();
  el.removeAttribute('contenteditable'); el.removeAttribute('data-wy-edit'); el.removeAttribute('spellcheck');
  E.el = null; E.start = null; E.range = null;
  try { V.win?.getSelection()?.removeAllRanges(); } catch {}
  if (changed && doCommit) commit();
  updateToolbar(); updateContextTabs();
}
function onSelectionChange() { if (E.el) { saveRange(); updateToolbar(); } }
function saveRange() {
  try {
    const s = V.win.getSelection();
    if (s.rangeCount && E.el && E.el.contains(s.getRangeAt(0).commonAncestorContainer)) E.range = s.getRangeAt(0).cloneRange();
  } catch {}
}
function restoreRange() {
  if (!E.el) return;
  if (V.doc.activeElement !== E.el) E.el.focus({ preventScroll: true });
  if (!E.range) return;
  const s = V.win.getSelection();
  s.removeAllRanges(); s.addRange(E.range);
}
function ensureEdit() {
  if (E.el) return true;
  if (SEL?.kind === 'box' && isTextBlock(SEL.el)) { const el = SEL.el; startEditing(el); selectAllIn(el); return true; }
  toast('Click into some text first');
  return false;
}
function wholeIfCollapsed() {
  const s = V.win.getSelection();
  if (!s.rangeCount || s.getRangeAt(0).collapsed) { selectAllIn(E.el); return true; }
  return false;
}
function cmd(name, value = null, css = false) {
  if (!ensureEdit()) return;
  restoreRange();
  if (name !== 'bold' && name !== 'italic' && name !== 'underline' && name !== 'strikeThrough') wholeIfCollapsed();
  try { V.doc.execCommand('styleWithCSS', false, css); } catch {}
  V.doc.execCommand(name, false, value);
  try { V.doc.execCommand('styleWithCSS', false, false); } catch {}
  markDirty(); saveRange(); updateToolbar();
}
function setColor(kind, color) {
  if (kind === 'color') {
    if (color) { cmd('foreColor', color, true); return; }
    if (!ensureEdit()) return;
    restoreRange(); wholeIfCollapsed();
    const r = V.win.getSelection().getRangeAt(0);
    E.el.querySelectorAll('font[color]').forEach(f => { if (r.intersectsNode(f)) f.removeAttribute('color'); });
    clearInline('color'); updateToolbar();
  }
  else if (kind === 'hilite') {
    if (!ensureEdit()) return;
    restoreRange(); wholeIfCollapsed();
    try { V.doc.execCommand('styleWithCSS', false, true); } catch {}
    const ok = V.doc.execCommand('hiliteColor', false, color || 'transparent');
    if (!ok) V.doc.execCommand('backColor', false, color || 'transparent');
    try { V.doc.execCommand('styleWithCSS', false, false); } catch {}
    if (!color) clearInline('background-color');
    markDirty(); updateToolbar();
  }
}
function clearInline(prop) {
  // Remove a property from spans in the current selection (used for "no colour").
  const s = V.win.getSelection(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  E.el.querySelectorAll('[style]').forEach(x => { if (r.intersectsNode(x)) { x.style.removeProperty(prop); if (!x.getAttribute('style')) x.removeAttribute('style'); } });
  markDirty();
}
function resizeText(f) {
  if (!ensureEdit()) return;
  restoreRange();
  const s = V.win.getSelection();
  const r = s.rangeCount ? s.getRangeAt(0) : null;
  const whole = !r || r.collapsed || r.toString().trim() === (E.el.textContent || '').trim();
  if (whole) {
    const px = parseFloat(V.win.getComputedStyle(E.el).fontSize) || 16;
    const next = Math.round(clamp(px * f, 8, 160));
    mirror(idOf(E.el), el => { el.style.fontSize = next + 'px'; });
    E.start?.set(idOf(E.el), attrsOf(E.el));
    commit();
  } else {
    const span = V.doc.createElement('span');
    span.style.fontSize = f > 1 ? '1.2em' : '0.84em';
    span.append(r.extractContents());
    r.insertNode(span);
    const nr = V.doc.createRange(); nr.selectNodeContents(span); s.removeAllRanges(); s.addRange(nr);
    saveRange(); markDirty();
  }
  updateToolbar();
}
function setFont(stack) {
  if (!ensureEdit()) return;
  restoreRange();
  const s = V.win.getSelection(); const r = s.rangeCount ? s.getRangeAt(0) : null;
  const whole = !r || r.collapsed || r.toString().trim() === (E.el.textContent || '').trim();
  if (whole || !stack) {
    mirror(idOf(E.el), el => { el.style.fontFamily = stack || ''; if (!el.getAttribute('style')) el.removeAttribute('style'); });
    if (!stack) { E.el.querySelectorAll('[style]').forEach(x => { x.style.removeProperty('font-family'); if (!x.getAttribute('style')) x.removeAttribute('style'); }); E.el.querySelectorAll('font[face]').forEach(x => x.removeAttribute('face')); markDirty(); }
    commit();
  } else cmd('fontName', stack, true);
  updateToolbar();
}
function setAlign(v) {
  const el = E.el || SEL?.el;
  if (!el) { toast('Click into some text first'); return; }
  mirror(idOf(el), x => { x.style.textAlign = v; });
  commit(); updateToolbar();
}
function setBlockStyle(tag) {
  const el = E.el || (SEL && isTextBlock(SEL.el) ? SEL.el : null);
  if (!el) { toast('Click into some text first'); return; }
  const id = idOf(el);
  const cur = el.tagName.toLowerCase();
  if (cur === tag) return;
  if (cur === 'li' || cur === 'td' || cur === 'th') { toast('Text in lists and tables keeps its style'); return; }
  finishEditing();
  mirror(id, (x, doc) => {
    const n = doc.createElement(tag);
    for (const a of [...x.attributes]) if (!['class', 'style', ...EDITOR_ATTRS].includes(a.name)) n.setAttribute(a.name, a.value);
    while (x.firstChild) n.append(x.firstChild);
    x.replaceWith(n);
  });
  commit();
  startEditing(vq(id));
}
function onEnter(shift) {
  const el = E.el, tag = el.tagName.toLowerCase();
  const s = V.win.getSelection(); const r = s.rangeCount ? s.getRangeAt(0) : null;
  let atEnd = false;
  if (r && r.collapsed) {
    const tail = V.doc.createRange(); tail.selectNodeContents(el); tail.setStart(r.endContainer, r.endOffset);
    atEnd = tail.toString().replace(/​/g, '').trim() === '' && !tail.cloneContents().querySelector?.('img');
  }
  if (!shift && (tag === 'li' || (atEnd && /^(p|h[1-6]|blockquote|dd|dt)$/.test(tag)))) {
    const newTag = tag === 'li' ? 'li' : 'p';
    finishEditing();
    const attrs = (newTag === tag && el.className) ? ` class="${esc(el.className)}"` : '';
    const nid = insertHtmlAfter(idOf(el), `<${newTag}${attrs}><br></${newTag}>`);
    commit();
    const nv = vq(nid); if (nv) startEditing(nv);
    return;
  }
  V.doc.execCommand('insertLineBreak') || V.doc.execCommand('insertHTML', false, '<br>');
  markDirty();
}

/* ============================== SELECTION (box / picture / label) ============================== */
function select(kind, el, { add = false } = {}) {
  if (add && SEL && SEL.kind !== 'label' && el && kind !== 'label') {
    // Add to (or take out of) a multi-selection
    if (!sq(idOf(el))) { toast('This part is made by the page’s own code, so it can’t be changed here'); return; }
    if (SEL.all.includes(el)) { SEL.all = SEL.all.filter(x => x !== el); el.removeAttribute('data-wy-sel'); }
    else if (SEL.all.some(x => x.contains(el) || el.contains(x))) { toast('That part is inside something already selected'); return; }
    else { SEL.all.push(el); el.setAttribute('data-wy-sel', ''); }
    if (!SEL.all.length) { deselect(); return; }
    SEL.el = SEL.all[SEL.all.length - 1];
    SEL.kind = SEL.all.every(x => x.tagName === 'IMG') ? 'pic' : 'box';
    updateContextTabs();
    showTab(SEL.kind === 'pic' ? 'picture' : 'box');
    return;
  }
  deselect();
  if (!el) return;
  if (!sq(idOf(el))) { toast('This part is made by the page’s own code, so it can’t be changed here'); return; }
  SEL = { kind, el, all: [el] };
  el.setAttribute('data-wy-sel', '');
  updateContextTabs();
  if (kind === 'pic') showTab('picture');
  else if (kind === 'box') showTab('box');
  else if (kind === 'label') openLabel();
}
function deselect() {
  (SEL?.all || (SEL?.el ? [SEL.el] : [])).forEach(x => x.removeAttribute('data-wy-sel'));
  SEL = null;
  updateContextTabs();
}

/* ---- Distribute: space 3+ selected boxes/pictures evenly across or down ----
   Positioned items (absolute, like slide cards) get new left/top values, PowerPoint style.
   Items in normal page flow get their margins adjusted so the gaps between them are equal.
   The first and last items stay where they are. */
function distribute(axis) {
  const els = SEL?.all || [];
  if (els.length < 3) { toast('Select 3 or more boxes or pictures first. Shift+click, or turn on Select several'); return; }
  if (E.el) finishEditing();
  const W = V.win, H = axis === 'h';
  const R = el => el.getBoundingClientRect();
  const sorted = [...els].sort((a, b) => H ? R(a).left - R(b).left : R(a).top - R(b).top);
  const first = sorted[0], last = sorted[sorted.length - 1];
  const ratio = first.offsetWidth ? R(first).width / first.offsetWidth : 1;
  const sizes = sorted.map(el => H ? R(el).width : R(el).height);
  const start = H ? R(first).left : R(first).top;
  const end = H ? R(last).right : R(last).bottom;
  const gap = (end - start - sizes.reduce((a, b) => a + b, 0)) / (sorted.length - 1);
  const positioned = sorted.every(el => /absolute|fixed/.test(W.getComputedStyle(el).position));
  const touched = new Set();
  if (positioned) {
    let pos = start;
    sorted.forEach((el, i) => {
      const cur = H ? R(el).left : R(el).top;
      const delta = (pos - cur) / ratio;
      if (i > 0 && i < sorted.length - 1 && Math.abs(delta) > 0.5) {
        const prop = H ? 'left' : 'top';
        const base = parseFloat(W.getComputedStyle(el)[prop]);
        const v = isNaN(base) ? (H ? el.offsetLeft : el.offsetTop) : base;
        el.style.setProperty(prop, Math.round((v + delta) * 10) / 10 + 'px');
        touched.add(el);
      }
      pos += sizes[i] + gap;
    });
  } else {
    if (H) {
      const row = sorted.every((el, i) => !i || (R(el).top < R(sorted[i - 1]).bottom && R(el).bottom > R(sorted[i - 1]).top));
      if (!row) { toast('These sit one above the other. Try Space down'); return; }
    }
    if (gap < 0) { toast('These overlap, so there’s no room to space them out'); return; }
    const saved = sorted.map(el => [el, el.getAttribute('style')]);
    const check = () => {
      const g = sorted.slice(1).map((el, i) => H ? R(el).left - R(sorted[i]).right : R(el).top - R(sorted[i]).bottom);
      return Math.max(...g) - Math.min(...g) <= 4;
    };
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], el = sorted[i];
      if (H) {
        el.style.marginLeft = '0px';
        const b = R(el).left - R(prev).right;
        el.style.marginLeft = ((gap - b) / ratio).toFixed(1) + 'px';
      } else {
        prev.style.marginBottom = '0px'; el.style.marginTop = '0px';
        const b = R(el).top - R(prev).bottom;
        el.style.marginTop = Math.max(0, (gap - b) / ratio).toFixed(1) + 'px';
        touched.add(prev);
      }
      touched.add(el);
    }
    if (!check()) {
      saved.forEach(([el, st]) => st == null ? el.removeAttribute('style') : el.setAttribute('style', st));
      toast('Other content sits between these, so they can’t be spaced evenly. Pick items that sit next to each other');
      return;
    }
  }
  if (!touched.size) { toast('Already evenly spaced'); return; }
  touched.forEach(el => {
    const s = sq(idOf(el)); if (!s) return;
    ['left', 'top', 'margin-left', 'margin-top', 'margin-bottom'].forEach(p => { const v = el.style.getPropertyValue(p); if (v) s.style.setProperty(p, v); });
  });
  commit(); placeHandlesSoon();
  toast(H ? 'Spaced evenly across' : 'Spaced evenly down', { action: 'Undo', onAction: undo });
}
function mirror(id, fn) {
  const s = sq(id); if (s) fn(s, S.doc);
  vqa(id).forEach(v => fn(v, V.doc));
}
function insertHtmlAfter(anchorId, html, { append = false } = {}) {
  const t = S.doc.createElement('template'); t.innerHTML = html.trim();
  const nodes = [...t.content.childNodes];
  nodes.forEach(n => { if (n.nodeType === 1) assignIds(n); });
  const viewNodes = nodes.map(n => V.doc.importNode(n, true));
  const s = sq(anchorId), v = vq(anchorId);
  if (append) { s?.append(...nodes); v?.append(...viewNodes); }
  else { s?.after(...nodes); v?.after(...viewNodes); }
  const first = nodes.find(n => n.nodeType === 1);
  return idOf(first);
}
function boxOp(op) {
  const el = SEL?.el || E.el;
  if (!el) { toast('Select something on the page first'); return; }
  if (E.el) finishEditing();
  const id = idOf(el), src = sq(id);
  if (!src) return;
  if (op === 'del') {
    const all = SEL?.all?.length ? SEL.all.map(idOf) : [id];
    all.forEach(i => mirror(i, x => x.remove()));
    deselect(); commit();
    toast(all.length > 1 ? `Deleted ${all.length} items` : 'Deleted', { action: 'Undo', onAction: undo });
  } else if (op === 'dup') {
    const clone = src.cloneNode(true);
    const { view: vc } = remapClone(clone, vq(id));
    src.after(clone); vq(id)?.after(vc);
    commit(); select(SEL?.kind || 'box', vc);
  } else if (op === 'up' || op === 'down') {
    const sib = op === 'up' ? src.previousElementSibling : src.nextElementSibling;
    if (!sib || !idOf(sib)) { toast(op === 'up' ? 'Already at the top' : 'Already at the bottom'); return; }
    const vs = vq(idOf(sib)), v = vq(id);
    if (op === 'up') { sib.before(src); if (vs && v) vs.before(v); } else { sib.after(src); if (vs && v) vs.after(v); }
    commit(); v?.scrollIntoView({ block: 'nearest' });
  } else if (op === 'parent') {
    const p = boxFor(el.parentElement || el);
    if (!p) { toast('This is already the largest area on the page'); return; }
    select('box', p);
  }
}
function boxColor(prop, color) {
  const els = E.el ? [E.el] : (SEL?.all || []);
  if (!els.length) { toast('Select something on the page first'); return; }
  els.forEach(el => {
    const id = idOf(el);
    const isSvg = !!el.closest('svg') && el.tagName.toLowerCase() !== 'svg';
    mirror(id, x => {
      if (isSvg && prop === 'backgroundColor') x.style.fill = color || '';
      else x.style[prop] = color || '';
      if (!x.getAttribute('style')) x.removeAttribute('style');
    });
    if (E.el) E.start?.set(id, attrsOf(E.el));
  });
  commit();
}
function tableOp(op) {
  const el = E.el || SEL?.el;
  const cell = el?.closest('td, th');
  if (!cell) { toast('Click into a table cell first'); return; }
  if (E.el) finishEditing();
  const srcCell = sq(idOf(cell)); if (!srcCell) return;
  const row = srcCell.closest('tr'), table = srcCell.closest('table');
  if (op === 'row') {
    const nr = row.cloneNode(true);
    nr.querySelectorAll('td, th').forEach(c => { c.innerHTML = '<br>'; });
    nr.querySelectorAll('th').forEach(th => { const td = S.doc.createElement('td'); for (const a of th.attributes) td.setAttribute(a.name, a.value); td.innerHTML = '<br>'; th.replaceWith(td); });
    [nr, ...nr.querySelectorAll('[data-wy]')].forEach(x => x.removeAttribute('data-wy'));
    assignIds(nr); row.after(nr);
  } else {
    const idx = [...row.children].indexOf(srcCell);
    table.querySelectorAll('tr').forEach(tr => {
      const ref = tr.children[Math.min(idx, tr.children.length - 1)];
      if (!ref) return;
      const c = ref.cloneNode(false); c.removeAttribute('data-wy'); c.innerHTML = '<br>'; assignIds(c); ref.after(c);
    });
  }
  commit({ structural: true });
  renderView();
}

/* ---- Pictures ---- */
function readAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
async function imageData(file) {
  if (!file.type.startsWith('image/')) throw new Error('not image');
  if (/svg|gif/.test(file.type) || file.size < 350e3 || !window.createImageBitmap) return readAsDataURL(file);
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86);
}
let pendingImage = null;
function pickImage(then) { pendingImage = then; const i = $('#imageInput'); i.value = ''; i.click(); }
async function replacePicture(file) {
  if (SEL?.kind !== 'pic') return;
  try {
    const url = await imageData(file);
    const id = idOf(SEL.el);
    const pic = SEL.el.parentElement?.tagName === 'PICTURE' ? SEL.el.parentElement : null;
    mirror(id, x => { x.setAttribute('src', url); x.removeAttribute('srcset'); x.removeAttribute('sizes'); });
    if (pic) [...pic.querySelectorAll('source')].forEach(so => mirror(idOf(so), x => x.remove()));
    commit();
  } catch { toast('That file isn’t a picture. Choose a JPG, PNG, GIF or SVG'); }
}
async function insertPicture(file) {
  try {
    const url = await imageData(file);
    const anchor = insertAnchor();
    const html = `<img src="" alt="" style="display:block;max-width:100%;height:auto;margin:12px 0">`;
    const nid = anchor.append ? insertHtmlAfter(anchor.id, html, { append: true }) : insertHtmlAfter(anchor.id, html);
    mirror(nid, x => x.setAttribute('src', url));
    commit();
    const v = vq(nid);
    if (v) { select('pic', v); v.scrollIntoView({ block: 'nearest' }); }
    toast('Picture added', { action: 'Describe it', onAction: () => picOp('alt') });
  } catch { toast('That file isn’t a picture. Choose a JPG, PNG, GIF or SVG'); }
}
function picOp(op) {
  if (SEL?.kind !== 'pic') { toast('Click a picture first'); return; }
  if (op === 'replace') pickImage(f => replacePicture(f));
  if (op === 'alt') { $('#altText').value = SEL.el.getAttribute('alt') || ''; mn.sheet('altSheet'); }
}
function picSize(pct) {
  if (SEL?.kind !== 'pic') return;
  SEL.all.forEach(el => mirror(idOf(el), x => { x.style.width = pct + '%'; x.style.height = 'auto'; x.style.maxWidth = '100%'; x.removeAttribute('width'); x.removeAttribute('height'); }));
  commit(); placeHandlesSoon();
}

/* ---- Insert ---- */
function insertAnchor() {
  const page = curViewEl();
  let el = E.el || SEL?.el || null;
  if (!el && page) {
    // Nothing selected: go after the last visible block of content on this page
    const blocks = [...page.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, table, figure, img, hr')]
      .filter(b => idOf(b) && !b.closest('svg') && b.getClientRects().length && !b.closest('li, td, th'));
    el = blocks[blocks.length - 1] || null;
  }
  // Climb out of inline, list-item and table-cell context so the new block lands in a sensible place
  while (el && el !== page && el.parentElement) {
    const tag = el.tagName.toLowerCase();
    if (el.closest('svg') && tag !== 'svg') { el = el.closest('svg'); continue; }
    if (INLINE.has(tag) && tag !== 'svg' && tag !== 'img') { el = el.parentElement; continue; }
    if (/^(li|td|th|tr|tbody|thead|tfoot|dt|dd|figcaption|caption)$/.test(tag)) { el = el.parentElement; continue; }
    break;
  }
  if (!el || el === page || !idOf(el) || el === V.doc.body) return { id: curId(), append: true };
  return { id: idOf(el), append: false };
}
function insertBlock(kind) {
  if (!V.ready) return;
  if (kind === 'img') { pickImage(f => insertPicture(f)); return; }
  const anchor = insertAnchor();
  const near = E.el || SEL?.el;
  if (E.el) finishEditing();
  const primary = token('--md-sys-color-primary') || 'currentColor';
  const onPrimary = token('--md-sys-color-on-primary') || 'white';
  let html;
  switch (kind) {
    case 'p': {
      const cls = near?.tagName === 'P' && near.className ? ` class="${esc(near.className)}"` : '';
      html = `<p${cls}>New text</p>`; break;
    }
    case 'h2': html = `<h2>New heading</h2>`; break;
    case 'ul': html = `<ul><li>First point</li><li>Second point</li></ul>`; break;
    case 'hr': html = `<hr>`; break;
    case 'table': {
      const cell = 'style="border:1px solid color-mix(in srgb, currentColor 25%, transparent);padding:6px 10px;text-align:left"';
      html = `<table style="border-collapse:collapse;width:100%;margin:12px 0"><thead><tr><th ${cell}>Heading</th><th ${cell}>Heading</th><th ${cell}>Heading</th></tr></thead><tbody><tr><td ${cell}>Text</td><td ${cell}>Text</td><td ${cell}>Text</td></tr><tr><td ${cell}>Text</td><td ${cell}>Text</td><td ${cell}>Text</td></tr></tbody></table>`;
      break;
    }
    case 'button': html = `<p><a href="https://" style="display:inline-block;padding:10px 22px;border-radius:999px;background:${primary};color:${onPrimary};text-decoration:none;font-weight:600">Button text</a></p>`; break;
    default: return;
  }
  deselect();
  const nid = anchor.append ? insertHtmlAfter(anchor.id, html, { append: true }) : insertHtmlAfter(anchor.id, html);
  commit();
  const v = vq(nid); if (!v) return;
  v.scrollIntoView({ block: 'nearest' });
  if (kind === 'p' || kind === 'h2') { startEditing(v); selectAllIn(v); }
  else if (kind === 'ul') { const li = v.querySelector('li'); startEditing(li); selectAllIn(li); }
  else if (kind === 'table') { const th = v.querySelector('th'); startEditing(th); selectAllIn(th); }
  else if (kind === 'button') {
    const a = v.querySelector('a'); if (a) { startEditing(v); selectAllIn(a); openLink(); }
  }
  else select('box', v);
}

/* ---- Links ---- */
function linkAtSelection() {
  const s = V.win.getSelection(); if (!s.rangeCount) return null;
  const n = elOf(s.getRangeAt(0).startContainer);
  const a = n?.closest('a');
  return a && E.el?.contains(a) ? a : (E.el?.tagName === 'A' ? E.el : (E.el?.closest('a') || null));
}
function openLink() {
  if (!E.el && !(SEL && isTextBlock(SEL.el))) { toast('Click into some text first'); return; }
  if (!E.el) startEditing(SEL.el);
  restoreRange();
  const a = linkAtSelection();
  const s = V.win.getSelection();
  E.link = { a, range: s.rangeCount ? s.getRangeAt(0).cloneRange() : null };
  $('#linkText').value = a ? a.textContent : (s.toString() || '');
  $('#linkUrl').value = a ? (a.getAttribute('href') || '') : '';
  $('#linkErr').textContent = '';
  $('#linkRemove').hidden = !a;
  $('#linkOk').textContent = a ? 'Update link' : 'Add link';
  mn.sheet('linkSheet');
  setTimeout(() => ($('#linkUrl').value ? $('#linkText') : $('#linkUrl')).focus(), 60);
}
function normalizeUrl(u) {
  u = u.trim();
  if (!u) return '';
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(u)) return 'mailto:' + u;
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(u)) return u;
  if (/^[\w-]+(\.[\w-]+)+/.test(u)) return 'https://' + u;
  return u;
}
function applyLink(result) {
  const L = E.link; E.link = null;
  if (!L || !E.el) return;
  E.el.focus({ preventScroll: true });
  const s = V.win.getSelection();
  if (L.range) { s.removeAllRanges(); s.addRange(L.range); }
  if (result === 'remove' && L.a) {
    L.a.replaceWith(...L.a.childNodes); markDirty(); flushSoon.now(); return;
  }
  if (result !== 'ok') return;
  const url = normalizeUrl($('#linkUrl').value);
  const text = $('#linkText').value.trim();
  if (!url) return;
  if (L.a) {
    L.a.setAttribute('href', url);
    if (text && text !== L.a.textContent) L.a.textContent = text;
  } else {
    const r = s.rangeCount ? s.getRangeAt(0) : null;
    if (r && !r.collapsed && (!text || text === r.toString())) V.doc.execCommand('createLink', false, url);
    else V.doc.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(text || url)}</a>`);
  }
  markDirty(); flushSoon.now();
}

/* ---- SVG labels ---- */
function openLabel() {
  if (SEL?.kind !== 'label') return;
  $('#labelText').value = SEL.el.textContent;
  mn.sheet('labelSheet');
  setTimeout(() => { $('#labelText').focus(); $('#labelText').select(); }, 60);
}

/* ---- Page code (advanced) ---- */
function openCode() {
  if (E.el) finishEditing();
  const src = sq(curId()); if (!src) return;
  const c = src.cloneNode(true);
  [c, ...c.querySelectorAll('[data-wy]')].forEach(x => x.removeAttribute('data-wy'));
  $('#codeText').value = src === S.doc.body ? c.innerHTML.trim() : c.outerHTML;
  $('#codeErr').textContent = '';
  mn.sheet('codeSheet');
}
function applyCode() {
  const src = sq(curId()); if (!src) return;
  const code = $('#codeText').value;
  if (src === S.doc.body) {
    src.innerHTML = code; assignIds(src);
  } else {
    const t = S.doc.createElement('template'); t.innerHTML = code.trim();
    const els = [...t.content.children];
    if (els.length !== 1) { $('#codeErr').textContent = 'The code needs to be one element, the page itself. Wrap it in a single tag.'; return false; }
    const n = els[0]; assignIds(n);
    src.replaceWith(n);
    S.pages[S.cur] = idOf(n);
  }
  commit({ structural: true });
  renderView();
  return true;
}

/* ============================== RIBBON ============================== */
function showTab(name) {
  $$('.rb-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  $$('.rb-panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
}
function updateContextTabs() {
  const pic = SEL?.kind === 'pic', box = SEL?.kind === 'box';
  $('.rb-tab[data-tab="picture"]').hidden = !pic;
  $('.rb-tab[data-tab="box"]').hidden = !box;
  const cur = $('.rb-tab[aria-selected="true"]');
  if (cur?.hidden) showTab('text');
  const el = E.el || SEL?.el;
  $('.table-only').hidden = !el?.closest?.('td, th');
  if (el?.closest?.('td, th') && !box && E.el) { $('.rb-tab[data-tab="box"]').hidden = false; }
  placeHandlesSoon();
  const n = SEL?.all?.length || 0;
  $$('.sel-count').forEach(t => { t.hidden = n < 2; t.textContent = `${n} selected`; });
  $$('[data-multi]').forEach(b => b.setAttribute('aria-pressed', String(!!V.multi)));
  $('#insertHint').textContent = (E.el || SEL) ? 'Adds below what you selected' : 'Adds after the last paragraph on this page';
}
const STYLE_NAMES = { h1: 'Title', h2: 'Heading', h3: 'Subheading', h4: 'Small heading', h5: 'Small heading', h6: 'Small heading', p: 'Normal text', blockquote: 'Quote', li: 'List item', td: 'Table text', th: 'Table heading', a: 'Link', button: 'Button' };
function updateToolbar() {
  const ok = !!E.el && V.doc;
  const q = c => { try { return ok && V.doc.queryCommandState(c); } catch { return false; } };
  $$('[data-cmd]').forEach(b => b.setAttribute('aria-pressed', String(q(b.dataset.cmd))));
  let align = '';
  if (ok) {
    const cs = V.win.getComputedStyle(E.el);
    align = cs.textAlign === 'start' ? 'left' : cs.textAlign === 'end' ? 'right' : cs.textAlign;
    $('#styleLabel').textContent = STYLE_NAMES[E.el.tagName.toLowerCase()] || 'Text';
    let col = ''; try { col = V.doc.queryCommandValue('foreColor'); } catch {}
    $('#colorBar').style.setProperty('--sw', col || 'currentColor');
    const ff = (V.win.getComputedStyle(elOf(V.win.getSelection().anchorNode) || E.el).fontFamily || '').split(',')[0].replace(/["']/g, '');
    $('#fontLabel').textContent = ff ? (ff.length > 14 ? ff.slice(0, 13) + '…' : ff) : 'Font';
  } else { $('#styleLabel').textContent = 'Text style'; $('#fontLabel').textContent = 'Font'; }
  $$('[data-align]').forEach(b => b.setAttribute('aria-pressed', String(ok && b.dataset.align === align)));
}

const PALETTE = [
  ['#000000', 'Black'], ['#434343', 'Dark grey'], ['#757575', 'Grey'], ['#bdbdbd', 'Light grey'], ['#e0e0e0', 'Pale grey'], ['#f3f3f3', 'Off white'], ['#ffffff', 'White'], [null, 'None'],
  ['#c62828', 'Red'], ['#ef6c00', 'Orange'], ['#f9a825', 'Yellow'], ['#2e7d32', 'Green'], ['#00838f', 'Teal'], ['#1565c0', 'Blue'], ['#6a1b9a', 'Purple'], ['#ad1457', 'Pink'],
  ['#ffcdd2', 'Light red'], ['#ffe0b2', 'Light orange'], ['#fff59d', 'Light yellow'], ['#c8e6c9', 'Light green'], ['#b2ebf2', 'Light teal'], ['#bbdefb', 'Light blue'], ['#e1bee7', 'Light purple'], ['#f8bbd0', 'Light pink'],
];
function buildSwatches() {
  $$('.swatches').forEach(box => {
    const kind = box.dataset.swatch;
    box.innerHTML = '';
    PALETTE.forEach(([c, name]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sw' + (c ? '' : ' none');
      b.title = name; b.setAttribute('aria-label', name);
      if (c) b.style.background = c;
      b.addEventListener('click', () => {
        box.closest('[popover]')?.hidePopover?.();
        if (kind === 'color') { setColor('color', c); $('#colorBar').style.setProperty('--sw', c || 'currentColor'); }
        else if (kind === 'hilite') { setColor('hilite', c); if (c) $('#hiliteBar').style.setProperty('--sw', c); }
        else if (kind === 'pagebg') { mirror(curId(), x => { x.style.background = c || ''; if (!x.getAttribute('style')) x.removeAttribute('style'); }); commit(); }
        else if (kind === 'boxbg') boxColor('backgroundColor', c);
        else if (kind === 'boxfg') boxColor('color', c);
      });
      box.append(b);
    });
  });
}

/* ============================== VIEWS (home / editor) ============================== */
function enterEditor() {
  $('#homeError').hidden = true;
  const show = () => {
    $('#home').hidden = true; $('#editor').hidden = false;
    $('#docName').textContent = S.name; document.title = `${S.name} · Pagewise`;
    setDirty(S.dirty);
    showTab('text');
    deselect();
    renderPageList();
    renderView();
    updateUndo(); updateToolbar();
  };
  if (window.mn && !$('#home').hidden) mn.go(show, { type: 'forward' }); else show();
  saveDraftSoon();
}
function leaveEditor() {
  const go = () => {
    if (E.el) finishEditing();
    saveDraft();
    const show = () => { $('#editor').hidden = true; $('#home').hidden = false; document.title = 'Pagewise'; renderRecents(); };
    window.mn ? mn.go(show, { type: 'back' }) : show();
    V.gen++; $('#view').srcdoc = ''; V.ready = false;
  };
  if (E.el) finishEditing();
  if (S.dirty) {
    $('#leaveText').textContent = `${S.name} has changes that aren’t in the file yet. A draft stays in this browser either way`;
    const d = mn.sheet('leaveSheet');
    d.addEventListener('close', async () => {
      if (d.returnValue === 'save') { if (await save()) go(); }
      else if (d.returnValue === 'leave') go();
    }, { once: true });
    d.returnValue = 'cancel';
  } else go();
}

/* ============================== WIRING ============================== */
function wire() {
  // Home
  $('#openBtn').addEventListener('click', openPicker);
  $('#blankBtn').addEventListener('click', () => loadText(BLANK, { name: 'Untitled document.html' }));
  $('#fileInput').addEventListener('change', e => { openFile(e.target.files[0]); e.target.value = ''; });
  document.addEventListener('mn:files', e => {
    const files = [...e.detail];
    if (!$('#editor').hidden) {
      const img = files.find(f => f.type.startsWith('image/'));
      if (img) { SEL?.kind === 'pic' ? replacePicture(img) : insertPicture(img); return; }
      const html = files.find(f => /\.html?$/i.test(f.name));
      if (html) { if (E.el) finishEditing(); saveDraft(); openFile(html); }
      return;
    }
    openFile(files[0]);
  });
  // The home drop zone opens the native picker when the FS Access API is available (so Save can write back)
  $('#homeDrop').addEventListener('click', e => { if (window.showOpenFilePicker) { e.preventDefault(); openPicker(); } });

  // Editor top bar
  $('#homeBtn').addEventListener('click', leaveEditor);
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  $('#saveBtn').addEventListener('click', () => save());
  $('#saveCopyBtn').addEventListener('click', () => save({ copy: true }));
  $('#presentBtn').addEventListener('click', present);
  $('#presentMenuBtn').addEventListener('click', present);
  $('#printBtn').addEventListener('click', printDoc);
  $('#codeBtn').addEventListener('click', openCode);
  wireLook();

  // Phones: the page counter opens the pages panel; real-size zoom; keyboard-aware height
  const phone = () => matchMedia('(max-width: 599px)').matches;
  const setPagesOpen = open => {
    if (open && !phone()) return;
    const ed = $('#editor');
    if (open) { if (E.el) finishEditing(); ed.setAttribute('data-pages-open', ''); $('#pagesScrim').hidden = false; markCurrentInList(); snapshot(); }
    else { ed.removeAttribute('data-pages-open'); $('#pagesScrim').hidden = true; }
  };
  $('#pageNum').addEventListener('click', () => setPagesOpen(!$('#editor').hasAttribute('data-pages-open')));
  $('#pagesScrim').addEventListener('click', () => setPagesOpen(false));
  $('#pageList').addEventListener('click', e => { if (e.target.closest('.pg')) setTimeout(() => setPagesOpen(false), 120); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setPagesOpen(false); });
  addEventListener('resize', () => { if (!phone()) setPagesOpen(false); });
  $('#zoomBtn').addEventListener('click', () => { V.zoom = !V.zoom; fit(); });
  const vv = window.visualViewport;
  if (vv) {
    const setVh = () => document.documentElement.style.setProperty('--vvh', vv.height + 'px');
    vv.addEventListener('resize', setVh); setVh();
  }

  // Ribbon: keep the page's text selection when pressing tools
  const keep = e => { if (e.target.closest('button') && !e.target.closest('dialog')) e.preventDefault(); };
  $('#ribbon').addEventListener('pointerdown', keep);
  $('#ribbon').addEventListener('mousedown', keep);
  $$('.rb-tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
  $$('[data-cmd]').forEach(b => b.addEventListener('click', () => cmd(b.dataset.cmd)));
  $$('[data-align]').forEach(b => b.addEventListener('click', () => setAlign(b.dataset.align)));
  $$('[data-style]').forEach(b => b.addEventListener('click', () => setBlockStyle(b.dataset.style)));
  $$('[data-font]').forEach(b => b.addEventListener('click', () => setFont(b.dataset.font)));
  $('[data-act="bigger"]').addEventListener('click', () => resizeText(1.15));
  $('[data-act="smaller"]').addEventListener('click', () => resizeText(1 / 1.15));
  $('[data-act="link"]').addEventListener('click', openLink);
  $('[data-act="clear"]').addEventListener('click', () => {
    if (!ensureEdit()) return;
    restoreRange(); wholeIfCollapsed();
    V.doc.execCommand('removeFormat'); markDirty(); updateToolbar();
  });
  $$('[data-insert]').forEach(b => b.addEventListener('click', () => insertBlock(b.dataset.insert)));
  $$('[data-page]').forEach(b => b.addEventListener('click', () => pageOp(b.dataset.page)));
  $$('[data-box]').forEach(b => b.addEventListener('click', () => boxOp(b.dataset.box)));
  $$('[data-pic]').forEach(b => b.addEventListener('click', () => picOp(b.dataset.pic)));
  $$('[data-pic-size]').forEach(b => b.addEventListener('click', () => picSize(+b.dataset.picSize)));
  $$('[data-table]').forEach(b => b.addEventListener('click', () => tableOp(b.dataset.table)));
  $$('[data-dist]').forEach(b => b.addEventListener('click', () => distribute(b.dataset.dist)));
  $$('[data-resetsize]').forEach(b => b.addEventListener('click', resetSize));
  $$('[data-multi]').forEach(b => b.addEventListener('click', () => {
    V.multi = !V.multi; updateContextTabs();
    toast(V.multi ? 'Tap boxes or pictures to add them to the selection' : 'Back to selecting one thing at a time');
  }));
  $('#imageInput').addEventListener('change', e => { const f = e.target.files[0]; if (f && pendingImage) pendingImage(f); pendingImage = null; });
  buildSwatches();

  // Sheets
  $('#linkSheet').addEventListener('close', () => applyLink($('#linkSheet').returnValue));
  $('#linkSheet').addEventListener('cancel', () => { $('#linkSheet').returnValue = 'cancel'; });
  $('#linkRemove').addEventListener('click', () => $('#linkSheet').close('remove'));
  $('#linkForm').addEventListener('submit', e => {
    if (e.submitter?.value === 'ok' && !$('#linkUrl').value.trim()) { e.preventDefault(); $('#linkErr').textContent = 'Add a web address, like example.com'; $('#linkUrl').focus(); }
  });
  $('#altSheet').addEventListener('close', () => {
    if ($('#altSheet').returnValue === 'ok' && SEL?.kind === 'pic') { const v = $('#altText').value.trim(); mirror(idOf(SEL.el), x => x.setAttribute('alt', v)); commit(); }
  });
  $('#labelSheet').addEventListener('close', () => {
    if ($('#labelSheet').returnValue === 'ok' && SEL?.kind === 'label') {
      const v = $('#labelText').value;
      mirror(idOf(SEL.el), x => { x.textContent = v; });
      commit();
    }
    deselect();
  });
  $('#codeSheet').querySelector('form').addEventListener('submit', e => {
    if (e.submitter?.value === 'ok' && applyCode() === false) e.preventDefault();
  });
  ['linkSheet', 'altSheet', 'labelSheet', 'codeSheet'].forEach(id => $('#' + id).addEventListener('close', () => { $('#' + id).returnValue = ''; }, { capture: false }));

  // Page navigation
  $('#prevPage').addEventListener('click', () => goPage(S.cur - 1));
  $('#nextPage').addEventListener('click', () => goPage(S.cur + 1));
  const list = $('#pageList');
  list.addEventListener('click', e => { const li = e.target.closest('.pg'); if (li) goPage([...list.children].indexOf(li)); });
  list.addEventListener('keydown', e => { const li = e.target.closest('.pg'); if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); goPage([...list.children].indexOf(li)); } });
  let dragFrom = -1;
  list.addEventListener('dragstart', e => { const li = e.target.closest('.pg'); if (!li) return; dragFrom = [...list.children].indexOf(li); li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); });
  list.addEventListener('dragover', e => {
    if (dragFrom < 0) return; e.preventDefault();
    $$('.pg', list).forEach(x => x.classList.remove('drop-before', 'drop-after'));
    const li = e.target.closest('.pg'); if (!li) return;
    const r = li.getBoundingClientRect();
    const vertical = getComputedStyle(list).flexDirection === 'column';
    const after = vertical ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    li.classList.add(after ? 'drop-after' : 'drop-before');
  });
  list.addEventListener('drop', e => {
    if (dragFrom < 0) return; e.preventDefault();
    const li = e.target.closest('.pg');
    let to = li ? [...list.children].indexOf(li) : S.pages.length - 1;
    if (li?.classList.contains('drop-after')) to += 1;
    if (to > dragFrom) to -= 1;
    const from = dragFrom; dragFrom = -1;
    $$('.pg', list).forEach(x => x.classList.remove('drop-before', 'drop-after', 'dragging'));
    if (E.el) finishEditing();
    deselect();
    movePage(from, clamp(to, 0, S.pages.length - 1));
    setCurrentInView(); fit();
  });
  list.addEventListener('dragend', () => { dragFrom = -1; $$('.pg', list).forEach(x => x.classList.remove('drop-before', 'drop-after', 'dragging')); });

  // Keyboard in the editor chrome
  document.addEventListener('keydown', e => {
    if ($('#editor').hidden || document.querySelector('dialog[open]')) return;
    const inField = e.target.closest?.('input, textarea, select, [contenteditable]');
    onKey(e, inField ? 'input' : false);
  });

  new ResizeObserver(() => { if (!$('#editor').hidden) fitSoon(); }).observe($('#frameWrap'));
  addEventListener('beforeunload', () => { if (S.doc && !$('#editor').hidden) { if (E.el) flush(); saveDraft(); } });
  addEventListener('pagehide', () => { if (S.doc && !$('#editor').hidden) saveDraft(); });
}

/* ============================== APPEARANCE ============================== */
// Colour set (palette), light/dark, colour strength (Material Next dial) and tool colours.
const LOOK_DEFAULT = { palette: 'bloom', mode: 'system', dial: 'expressive', tones: 'multi' };
function currentLook() {
  const r = document.documentElement;
  return {
    palette: r.dataset.palette || 'bloom',
    mode: window.mn ? mn.theme() : (r.dataset.theme || 'system'),
    dial: r.dataset.expressiveness || 'expressive',
    tones: r.dataset.tones || 'multi',
  };
}
function applyLook(next) {
  const r = document.documentElement;
  const cur = { ...currentLook(), ...next };
  const run = () => {
    if (cur.palette === 'bloom') delete r.dataset.palette; else r.dataset.palette = cur.palette;
    if (cur.tones === 'multi') delete r.dataset.tones; else r.dataset.tones = cur.tones;
    store.set('pw:palette', cur.palette === 'bloom' ? '' : cur.palette);
    store.set('pw:tones', cur.tones === 'multi' ? '' : cur.tones);
    if (!store.get('pw:palette')) store.del('pw:palette');
    if (!store.get('pw:tones')) store.del('pw:tones');
    mn.theme(cur.mode);
    mn.dial(cur.dial);
  };
  run();
  syncLook();
  // Selection outlines inside the page use the theme's colours
  if (V.ready && V.doc) { const st = V.doc.querySelector('style[data-pw]'); if (st) st.textContent = viewCSS(); }
}
function syncLook() {
  const L = currentLook();
  $$('.pal').forEach(b => b.setAttribute('aria-checked', String(b.dataset.pick === L.palette)));
  $$('#modeSeg [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === L.mode)));
  $$('#dialSeg [data-dial]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dial === L.dial)));
  $$('#tonesSeg [data-tones]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tones === L.tones)));
}
function wireLook() {
  document.addEventListener('click', e => {
    if (e.target.closest('[data-look]')) { syncLook(); mn.sheet('lookSheet'); }
  });
  $$('.pal').forEach(b => b.addEventListener('click', () => applyLook({ palette: b.dataset.pick })));
  $$('#modeSeg [data-mode]').forEach(b => b.addEventListener('click', () => applyLook({ mode: b.dataset.mode })));
  $$('#dialSeg [data-dial]').forEach(b => b.addEventListener('click', () => applyLook({ dial: b.dataset.dial })));
  $$('#tonesSeg [data-tones]').forEach(b => b.addEventListener('click', () => applyLook({ tones: b.dataset.tones })));
  $('#lookReset').addEventListener('click', () => applyLook(LOOK_DEFAULT));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncLook);
}

function init() {
  wire();
  renderRecents();
  const p = new URLSearchParams(location.search).get('open');
  if (p) openUrl(p);
  // Small API for automation and testing
  window.Pagewise = {
    openText: (text, name) => loadText(text, { name: name || 'page.html' }),
    openUrl, html: () => faithfulSerialize(), plainHtml: () => serialize(false), state: S, view: V, goPage, undo, redo, save,
  };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
