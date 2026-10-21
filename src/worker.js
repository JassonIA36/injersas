// INJER S.A.S. - Worker: sirve el sitio con el contenido de D1 y el panel /admin.

import { isAuthed, handleLogin, handleLogout, json } from './auth.js';
import { renderPage } from './page.js';
import { handleImage, handleUpload, handleSave } from './api.js';
import { loginPage } from './login.js';

const htmlHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      // Pagina publica
      if (pathname === '/' || pathname === '/index.html') {
        if (pathname === '/index.html') return Response.redirect(url.origin + '/', 301);
        if (method !== 'GET' && method !== 'HEAD') return new Response('Metodo no permitido', { status: 405 });
        return await renderPage(request, env);
      }

      // Panel de edicion: la misma pagina en modo edicion, o el login
      if (pathname === '/admin' || pathname === '/admin/') {
        if (await isAuthed(request, env)) return await renderPage(request, env, { admin: true });
        return new Response(loginPage, { headers: htmlHeaders });
      }

      // Fotos subidas
      const img = pathname.match(/^\/img\/(\d{1,12})$/);
      if (img && (method === 'GET' || method === 'HEAD')) return await handleImage(Number(img[1]), env);

      // API (solo POST, con comprobacion de origen)
      if (pathname.startsWith('/api/')) {
        if (method !== 'POST') return json({ error: 'Metodo no permitido' }, 405);
        const origin = request.headers.get('Origin');
        if (origin && new URL(origin).host !== url.host) return json({ error: 'Origen no permitido' }, 403);

        if (pathname === '/api/login') return await handleLogin(request, env);
        if (pathname === '/api/logout') return await handleLogout(request, env);

        // Todo lo que escribe exige sesion
        if (!(await isAuthed(request, env))) return json({ error: 'Tu sesión expiró. Vuelve a entrar en /admin.' }, 401);
        if (pathname === '/api/guardar') return await handleSave(request, env, ctx);
        if (pathname === '/api/img') return await handleUpload(request, env);
        return json({ error: 'No encontrado' }, 404);
      }

      // Todo lo demas: archivos estaticos (css, js, assets, editor)
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: 'Error interno del servidor.' }, 500);
    }
  },
};
