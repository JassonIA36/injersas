// Lee public/index.html, le inyecta el contenido de D1 con HTMLRewriter
// y lo devuelve ya armado (los textos reales llegan en el HTML, sin parpadeo).

export const SETTINGS_KEYS = ['seo_titulo', 'seo_descripcion', 'telefono_numero', 'whatsapp_numero', 'facebook_url'];

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\{/g, '&#123;'); // evita que un texto del cliente se lea como {{marcador}}

export function imgUrl(v) {
  v = String(v ?? '');
  if (/^\d{1,12}$/.test(v)) return '/img/' + v;
  if (/^\/assets\/[\w.\-/]+$/.test(v) && !v.includes('..')) return v;
  return '';
}

// ---- Lo que el HTML declara como editable ---------------------------------
export function parseSchema(html) {
  const keys = new Set(); // claves de contenido permitidas
  for (const m of html.matchAll(/data-edit="([a-z0-9_]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-edit-(?:img|bg)="([a-z0-9_]+)"/g)) keys.add('img_' + m[1]);
  SETTINGS_KEYS.forEach((k) => keys.add(k));

  const lists = {}; // nombre -> { template, fields:Set, imgFields:Set, lineFields:Set }
  const re = /data-list="([a-z0-9_]+)"[^>]*>\s*<template data-tpl>([\s\S]*?)<\/template>/g;
  for (const m of html.matchAll(re)) {
    const template = m[2];
    const fields = new Set();
    const imgFields = new Set();
    const lineFields = new Set();
    for (const f of template.matchAll(/\{\{#lines ([a-z_]+)\}\}/g)) {
      fields.add(f[1]);
      lineFields.add(f[1]);
    }
    for (const f of template.matchAll(/\{\{\s*([a-z_]+)(?:\|(url|img))?\s*\}\}/g)) {
      fields.add(f[1]);
      if (f[2] === 'img') imgFields.add(f[1]);
    }
    lists[m[1]] = { template, fields, imgFields, lineFields };
  }
  const wa = (html.match(/<body[^>]*data-wa="(\d+)"/) || [])[1] || '';
  return { keys, lists, wa };
}

// ---- Plantillas de lista --------------------------------------------------
function renderItem(tpl, item, wa) {
  let out = tpl.replace(/\{\{#lines ([a-z_]+)\}\}([\s\S]*?)\{\{\/lines\}\}/g, (_, f, inner) =>
    String(item[f] ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => inner.replace(/\{\{\.\}\}/g, () => esc(l)))
      .join('')
  );
  out = out.replace(/\{\{\s*(@wa|[a-z_]+)(?:\|(url|img))?\s*\}\}/g, (_, name, filter) => {
    if (name === '@wa') return wa;
    const v = String(item[name] ?? '');
    if (filter === 'url') return encodeURIComponent(v);
    if (filter === 'img') return esc(imgUrl(v));
    if (name === 'icono') return esc(v.replace(/[^\w\- ]/g, ''));
    return esc(v);
  });
  return out;
}

function setText(el, value) {
  const parts = String(value).split('\n');
  el.setInnerContent(parts[0]); // texto plano: HTMLRewriter lo escapa
  for (let i = 1; i < parts.length; i++) {
    el.append('<br>', { html: true });
    el.append(parts[i]);
  }
}

const digits = (s) => String(s || '').replace(/\D/g, '');

// ---- Armado de la pagina --------------------------------------------------
export async function renderPage(request, env, { admin = false } = {}) {
  const url = new URL(request.url);
  const assetRes = await env.ASSETS.fetch(new Request(new URL('/index.html', url)));
  if (!assetRes.ok) return new Response('No se encontro index.html', { status: 500 });
  const html = await assetRes.text();
  const schema = parseSchema(html);

  const c = {};
  const rows = {};
  try {
    const [cont, lis] = await env.DB.batch([
      env.DB.prepare('SELECT clave, valor FROM contenido'),
      env.DB.prepare('SELECT seccion, campos FROM listas ORDER BY seccion, orden, id'),
    ]);
    for (const r of cont.results) c[r.clave] = r.valor;
    for (const r of lis.results) {
      try {
        (rows[r.seccion] ||= []).push(JSON.parse(r.campos));
      } catch {
        /* fila danada: se ignora */
      }
    }
  } catch (err) {
    console.error('D1 no disponible, se muestra el contenido por defecto', err);
  }

  const wa = digits(c.whatsapp_numero) || schema.wa;
  const tel = digits(c.telefono_numero);
  const lists = {}; // listas administradas desde D1
  for (const name of Object.keys(schema.lists)) {
    if (c['lista_' + name] === '1') lists[name] = rows[name] || [];
  }

  const rw = new HTMLRewriter();

  if (c.seo_titulo) rw.on('title', { element: (el) => el.setInnerContent(c.seo_titulo) });
  rw.on('meta[name="description"]', {
    element(el) {
      if (c.seo_descripcion) el.setAttribute('content', c.seo_descripcion);
    },
  });
  if (admin) {
    rw.on('meta[name="robots"]', { element: (el) => el.setAttribute('content', 'noindex, nofollow') });
    rw.on('head', {
      element(el) {
        el.append('<link rel="stylesheet" href="/_edit/editor.css">', { html: true });
      },
    });
  }

  rw.on('body', {
    element(el) {
      el.setAttribute('data-wa', wa);
      if (admin) {
        const data = JSON.stringify({ listas: lists }).replace(/</g, '\\u003c');
        el.append(`<script type="application/json" id="edit-data">${data}</script><script src="/_edit/editor.js" defer></script>`, { html: true });
      }
    },
  });

  rw.on('template[data-tpl]', { element: (el) => el.remove() });

  rw.on('[data-edit]', {
    element(el) {
      const k = el.getAttribute('data-edit');
      if (Object.prototype.hasOwnProperty.call(c, k)) setText(el, c[k]);
    },
  });

  rw.on('[data-edit-img]', {
    element(el) {
      const id = c['img_' + el.getAttribute('data-edit-img')];
      if (id && /^\d+$/.test(id)) el.setAttribute(el.tagName === 'link' ? 'href' : 'src', '/img/' + id);
    },
  });

  rw.on('[data-edit-bg]', {
    element(el) {
      const id = c['img_' + el.getAttribute('data-edit-bg')];
      if (id && /^\d+$/.test(id)) el.setAttribute('style', `${el.getAttribute('style') || ''}--hero-bg:url('/img/${id}');`);
    },
  });

  rw.on('[data-link]', {
    element(el) {
      const kind = el.getAttribute('data-link');
      const href = el.getAttribute('href') || '';
      if (kind === 'telefono' && tel) el.setAttribute('href', 'tel:+' + tel);
      else if (kind === 'whatsapp' && c.whatsapp_numero && wa) el.setAttribute('href', href.replace(/wa\.me\/\d+/, 'wa.me/' + wa));
      else if (kind === 'facebook' && /^https:\/\//.test(c.facebook_url || '')) el.setAttribute('href', c.facebook_url);
    },
  });

  rw.on('[data-list]', {
    element(el) {
      const name = el.getAttribute('data-list');
      const def = schema.lists[name];
      if (!def || !(name in lists)) return;
      el.setInnerContent(lists[name].map((item) => renderItem(def.template, item, wa)).join('\n'), { html: true });
    },
  });

  const out = rw.transform(new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  const headers = new Headers(out.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (admin) {
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  } else {
    headers.set('Cache-Control', 'no-cache');
  }
  return new Response(out.body, { status: 200, headers });
}
