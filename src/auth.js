// Autenticacion: un solo administrador, clave con PBKDF2 (WebCrypto),
// cookie de sesion HttpOnly + Secure + SameSite=Strict y limite de intentos.

const enc = new TextEncoder();

const SESSION_TTL = 24 * 60 * 60; // segundos
const MAX_FAILS = 5;
const LOCK_SECONDS = 15 * 60;
const COOKIE = 'sid';

const now = () => Math.floor(Date.now() / 1000);

function toB64u(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function timingEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Formato guardado: pbkdf2-sha256$ITERACIONES$SAL_BASE64$HASH_BASE64
async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored || '').split('$');
  const iterations = parseInt(iter, 10);
  // Cloudflare Workers permite como maximo 100000 iteraciones en PBKDF2
  if (scheme !== 'pbkdf2-sha256' || !(iterations >= 1000 && iterations <= 100000) || !salt || !hash) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(salt), iterations }, key, 256);
  return timingEqual(new Uint8Array(bits), fromB64(hash));
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

const cookieHeader = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

export async function isAuthed(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token || token.length > 100 || !env.SESSION_SECRET) return false;
  try {
    const id = 's:' + (await hmacHex(env.SESSION_SECRET, token));
    const row = await env.DB.prepare('SELECT 1 AS ok FROM sesiones WHERE id = ? AND tipo = ? AND expira > ?')
      .bind(id, 'sesion', now())
      .first();
    return !!row;
  } catch {
    return false;
  }
}

export async function handleLogin(request, env) {
  if (!env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) {
    return json({ error: 'El servidor no está configurado: faltan los secrets (ver GUIA.md).' }, 500);
  }
  const t = now();
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const key = 'intento:' + ip;

  const rec = await env.DB.prepare('SELECT n, expira FROM sesiones WHERE id = ? AND tipo = ?').bind(key, 'intento').first();
  const active = rec && rec.expira > t;
  if (active && rec.n >= MAX_FAILS) {
    return json({ error: `Demasiados intentos fallidos. Espera ${Math.ceil((rec.expira - t) / 60)} minuto(s) e inténtalo de nuevo.` }, 429);
  }

  let password = '';
  try {
    password = String((await request.json()).password ?? '');
  } catch {
    return json({ error: 'Solicitud inválida.' }, 400);
  }

  const ok = password.length > 0 && password.length <= 200 && (await verifyPassword(password, env.ADMIN_PASSWORD_HASH));

  if (!ok) {
    const n = active ? rec.n + 1 : 1;
    const expira = active ? rec.expira : t + LOCK_SECONDS;
    await env.DB.prepare(
      'INSERT INTO sesiones (id, tipo, n, expira) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET n = excluded.n, expira = excluded.expira'
    )
      .bind(key, 'intento', n, expira)
      .run();
    const left = MAX_FAILS - n;
    return json(
      { error: left > 0 ? `Contraseña incorrecta. Te quedan ${left} intento(s).` : 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.' },
      left > 0 ? 401 : 429
    );
  }

  const token = toB64u(crypto.getRandomValues(new Uint8Array(32)));
  const id = 's:' + (await hmacHex(env.SESSION_SECRET, token));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sesiones WHERE id = ?').bind(key),
    env.DB.prepare('DELETE FROM sesiones WHERE expira < ?').bind(t),
    env.DB.prepare('INSERT INTO sesiones (id, tipo, n, expira) VALUES (?, ?, 0, ?)').bind(id, 'sesion', t + SESSION_TTL),
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(token, SESSION_TTL) });
}

export async function handleLogout(request, env) {
  const token = readCookie(request, COOKIE);
  if (token && env.SESSION_SECRET) {
    const id = 's:' + (await hmacHex(env.SESSION_SECRET, token));
    await env.DB.prepare('DELETE FROM sesiones WHERE id = ?').bind(id).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', 0) });
}

export { json };
