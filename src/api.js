// Rutas de escritura (todas exigen sesion; lo verifica worker.js) y servicio de fotos.

import { json } from './auth.js';
import { parseSchema, imgUrl } from './page.js';

const MAX_IMG_BYTES = 500 * 1024; // el navegador sube <200 KB; este es el tope duro del servidor
const MAX_BODY = 400 * 1024;
const MAX_ITEMS = 100;

const now = () => Math.floor(Date.now() / 1000);

const CONTROL = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]", "g");

function cleanText(v, max) {
  if (typeof v !== 'string') throw new Error('Valor inválido');
  const s = v.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  if (s.length > max) throw new Error(`Un texto supera el máximo de ${max} caracteres`);
  return s;
}

function sniffType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
    return 'image/webp';
  return null;
}

async function loadSchema(request, env) {
  const res = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
  return parseSchema(await res.text());
}

// ---- GET /img/:id ----------------------------------------------------------
export async function handleImage(id, env) {
  const row = await env.DB.prepare('SELECT datos, tipo FROM imagenes WHERE id = ?').bind(id).first();
  if (!row) return new Response('No encontrada', { status: 404 });
  const d = row.datos;
  const bytes = d instanceof ArrayBuffer ? new Uint8Array(d) : Array.isArray(d) ? Uint8Array.from(d) : new Uint8Array(d.buffer ?? d);
  return new Response(bytes, {
    headers: {
      'Content-Type': row.tipo,
      // Cada subida tiene un id nuevo, por eso el cache puede ser eterno
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

// Guarda la foto como BLOB. Se comprueba el largo guardado y, si el driver no
// aceptara el ArrayBuffer tal cual, se reintenta como lista de bytes.
async function insertBlob(env, buf, type) {
  const sql = 'INSERT INTO imagenes (datos, tipo, fecha) VALUES (?, ?, ?)';
  for (const value of [buf, Array.from(new Uint8Array(buf))]) {
    try {
      const res = await env.DB.prepare(sql).bind(value, type, now()).run();
      const id = res.meta.last_row_id;
      const chk = await env.DB.prepare('SELECT length(datos) AS n FROM imagenes WHERE id = ?').bind(id).first();
      if (chk && chk.n === buf.byteLength) return id;
      await env.DB.prepare('DELETE FROM imagenes WHERE id = ?').bind(id).run();
    } catch (e) {
      console.error('insert blob', e);
    }
  }
  throw new Error('No se pudo guardar la foto.');
}

// ---- POST /api/img ---------------------------------------------------------
export async function handleUpload(request, env) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/webp', 'image/jpeg', 'image/png'].includes(type)) return json({ error: 'Solo se aceptan imágenes WebP, JPEG o PNG.' }, 415);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_IMG_BYTES) return json({ error: 'La imagen es demasiado grande.' }, 413);

  const buf = await request.arrayBuffer();
  if (buf.byteLength < 100 || buf.byteLength > MAX_IMG_BYTES) return json({ error: 'La imagen es demasiado grande o está vacía.' }, 413);
  if (sniffType(new Uint8Array(buf, 0, 12)) !== type) return json({ error: 'El archivo no es una imagen válida.' }, 415);

  return json({ id: await insertBlob(env, buf, type) });
}

// ---- POST /api/guardar -----------------------------------------------------
export async function handleSave(request, env, ctx) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return json({ error: 'Demasiados datos.' }, 413);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Solicitud inválida.' }, 400);
  }
  const schema = await loadSchema(request, env);
  const stmts = [];
  const imageIds = new Set();

  try {
    // Textos, claves de imagen y ajustes
    for (const [k, raw] of Object.entries(body.contenido || {})) {
      if (!schema.keys.has(k)) throw new Error(`Campo desconocido: ${k}`);
      let v;
      if (k.startsWith('img_') && raw === '') {
        stmts.push(env.DB.prepare('DELETE FROM contenido WHERE clave = ?').bind(k));
        continue;
      }
      if (k.startsWith('img_')) {
        v = cleanText(raw, 12);
        if (!/^\d{1,12}$/.test(v)) throw new Error('Imagen inválida');
        imageIds.add(Number(v));
      } else if (k === 'telefono_numero' || k === 'whatsapp_numero') {
        v = cleanText(raw, 20).replace(/[\s+()-]/g, '');
        if (!/^\d{7,15}$/.test(v)) throw new Error('El teléfono debe tener solo números (7 a 15 dígitos, con indicativo de país).');
      } else if (k === 'facebook_url') {
        v = cleanText(raw, 300);
        if (!/^https:\/\/[^\s"'<>]{4,}$/.test(v)) throw new Error('El enlace de Facebook debe empezar por https://');
      } else if (k === 'seo_titulo' || k === 'seo_descripcion') {
        v = cleanText(raw, 400).replace(/\n+/g, ' ');
      } else {
        v = cleanText(raw, 3000);
      }
      stmts.push(
        env.DB.prepare('INSERT INTO contenido (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').bind(k, v)
      );
    }

    // Listas
    for (const [name, items] of Object.entries(body.listas || {})) {
      const def = schema.lists[name];
      if (!def) throw new Error(`Lista desconocida: ${name}`);
      if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) throw new Error(`La lista debe tener entre 1 y ${MAX_ITEMS} elementos.`);
      stmts.push(env.DB.prepare('DELETE FROM listas WHERE seccion = ?').bind(name));
      items.forEach((item, i) => {
        const campos = {};
        for (const f of def.fields) {
          let v = cleanText(item?.[f] ?? '', def.lineFields.has(f) ? 2000 : 1000);
          if (def.imgFields.has(f)) {
            if (v && !imgUrl(v)) throw new Error('Foto inválida');
            if (/^\d+$/.test(v)) imageIds.add(Number(v));
          } else if (f === 'icono') {
            v = v.replace(/[^\w\- ]/g, '');
          } else if (!def.lineFields.has(f)) {
            v = v.replace(/\n+/g, ' ');
          }
          campos[f] = v;
        }
        stmts.push(env.DB.prepare('INSERT INTO listas (seccion, orden, campos) VALUES (?, ?, ?)').bind(name, i, JSON.stringify(campos)));
      });
      stmts.push(
        env.DB.prepare("INSERT INTO contenido (clave, valor) VALUES (?, '1') ON CONFLICT(clave) DO UPDATE SET valor = '1'").bind('lista_' + name)
      );
    }

    // Las fotos referenciadas tienen que existir
    const ids = [...imageIds];
    if (ids.length) {
      const found = await env.DB.prepare(`SELECT id FROM imagenes WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
      if (found.results.length !== ids.length) throw new Error('Una de las fotos no existe. Vuelve a subirla.');
    }
  } catch (err) {
    return json({ error: err.message }, 400);
  }

  if (!stmts.length) return json({ ok: true });
  await env.DB.batch(stmts); // todo o nada
  ctx.waitUntil(cleanupImages(env).catch((e) => console.error('cleanup', e)));
  return json({ ok: true });
}

// Borra fotos que ya no usa nada (con mas de 1 hora, para no tocar subidas en curso)
async function cleanupImages(env) {
  const used = new Set();
  const [cont, lis, old] = await env.DB.batch([
    env.DB.prepare("SELECT valor FROM contenido WHERE clave LIKE 'img\\_%' ESCAPE '\\'"),
    env.DB.prepare('SELECT campos FROM listas'),
    env.DB.prepare('SELECT id FROM imagenes WHERE fecha < ?').bind(now() - 3600),
  ]);
  cont.results.forEach((r) => used.add(String(r.valor)));
  for (const r of lis.results) {
    try {
      Object.values(JSON.parse(r.campos)).forEach((v) => /^\d+$/.test(String(v)) && used.add(String(v)));
    } catch {
      /* ignorar */
    }
  }
  const orphans = old.results.filter((r) => !used.has(String(r.id))).slice(0, 50);
  if (orphans.length) await env.DB.batch(orphans.map((r) => env.DB.prepare('DELETE FROM imagenes WHERE id = ?').bind(r.id)));
}
