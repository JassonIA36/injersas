// Pruebas de extremo a extremo contra un "wrangler dev" en marcha.
//   1) npm run db:schema:local && npm run seed:local && npm run clave:dev
//   2) npm run dev           (en otra terminal)
//   3) npm test              (usa la clave que pusiste en clave:dev: variable TEST_PASSWORD)
//
// Deja la base local como estaba al empezar (restaura lo que modifica).
import zlib from 'node:zlib';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const PASSWORD = process.env.TEST_PASSWORD || 'PruebaClave2026!';
const ip = () => '10.9.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250);

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log('  ok   ' + name);
  } else {
    failed++;
    console.log('  FALLA ' + name + (extra ? '  -> ' + extra : ''));
  }
}

async function req(path, { method = 'GET', cookie, headers = {}, body, json, fakeIp } = {}) {
  const h = { 'CF-Connecting-IP': fakeIp || '10.0.0.1', ...headers };
  if (cookie) h.Cookie = cookie;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const res = await fetch(BASE + path, { method, headers: h, body, redirect: 'manual' });
  return res;
}
const text = async (path, opts) => (await req(path, opts)).text();

async function login(password, fakeIp) {
  const res = await req('/api/login', { method: 'POST', json: { password }, fakeIp });
  const setCookie = res.headers.get('set-cookie') || '';
  return { res, setCookie, cookie: setCookie.split(';')[0], body: await res.json() };
}

// PNG de verdad (RGB, 40x40) para probar la subida
function makePng() {
  const w = 40, h = 40;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (x * 7 + y * 13) & 255;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const editData = (html) => JSON.parse(html.match(/<script type="application\/json" id="edit-data">([\s\S]*?)<\/script>/)[1]);
const count = (html, re) => (html.match(re) || []).length;

console.log('\n== Pagina publica ==');
const home = await text('/');
check('la portada responde con los textos reales (para Google)', home.includes('Precisión Milimétrica en') && home.includes('INJER S.A.S.'));
check('las plantillas <template> no llegan al visitante', !home.includes('<template'));
check('las 6 tarjetas de servicios estan en el HTML', count(home, /class="service-card glass-card"/g) === 6, String(count(home, /class="service-card glass-card"/g)));
check('/index.html redirige a /', (await req('/index.html')).status === 301);

console.log('\n== Login ==');
const adminAnon = await text('/admin');
check('/admin sin sesion muestra el login', adminAnon.includes('id="f"') && !adminAnon.includes('editor.js'));
const bad = await login('clave-equivocada', ip());
check('clave incorrecta -> 401 con mensaje', bad.res.status === 401 && /incorrecta/i.test(bad.body.error), JSON.stringify(bad.body));
check('clave incorrecta no entrega cookie', !bad.setCookie);
const lockIp = ip();
let last;
for (let i = 0; i < 5; i++) last = await login('mala' + i, lockIp);
check('al 5.o intento fallido se bloquea (429)', last.res.status === 429, String(last.res.status));
const lockedGood = await login(PASSWORD, lockIp);
check('bloqueada la IP, ni la clave correcta entra', lockedGood.res.status === 429 && !lockedGood.setCookie);

const ok = await login(PASSWORD, ip());
check('clave correcta -> 200', ok.res.status === 200 && ok.body.ok === true, JSON.stringify(ok.body));
check('cookie HttpOnly', /HttpOnly/i.test(ok.setCookie));
check('cookie Secure', /;\s*Secure/i.test(ok.setCookie));
check('cookie SameSite=Strict', /SameSite=Strict/i.test(ok.setCookie));
const cookie = ok.cookie;

console.log('\n== Rutas de escritura exigen sesion ==');
check('guardar sin sesion -> 401', (await req('/api/guardar', { method: 'POST', json: { contenido: { hero_titulo_2: 'x' } } })).status === 401);
check('subir foto sin sesion -> 401', (await req('/api/img', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: makePng() })).status === 401);
check('cookie falsa -> 401', (await req('/api/guardar', { method: 'POST', cookie: 'sid=falsa', json: { contenido: {} } })).status === 401);
check('GET a /api/guardar no esta permitido', (await req('/api/guardar', { cookie })).status === 405);
check('origen distinto -> 403', (await req('/api/guardar', { method: 'POST', cookie, headers: { Origin: 'https://malo.example' }, json: { contenido: {} } })).status === 403);

console.log('\n== Modo edicion ==');
const admin = await text('/admin', { cookie });
check('/admin con sesion carga el editor', admin.includes('/_edit/editor.js') && admin.includes('id="edit-data"'));
check('/admin no se indexa', admin.includes('noindex'));
const base = editData(admin);
check('el editor recibe las listas (servicios = 6)', base.listas.servicios?.length === 6);

console.log('\n== Editar texto ==');
const originalTitle = (home.match(/<span class="gradient-text"[^>]*>([^<]*)<\/span>/) || [])[1];
const evil = '<script>alert(1)</script> Topografía & "más"';
let r = await req('/api/guardar', { method: 'POST', cookie, json: { contenido: { hero_titulo_2: evil } } });
check('guardar texto -> 200', r.status === 200, await r.clone().text());
let pub = await text('/');
check('el cambio se ve al recargar SIN sesion', pub.includes('&amp;'));
check('el HTML del cliente se muestra como texto (sin XSS)', !pub.includes('<script>alert(1)</script>') && pub.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
r = await req('/api/guardar', { method: 'POST', cookie, json: { contenido: { clave_inventada: 'x' } } });
check('clave desconocida -> 400', r.status === 400);
r = await req('/api/guardar', { method: 'POST', cookie, json: { contenido: { hero_titulo_2: 'a'.repeat(5000) } } });
check('texto demasiado largo -> 400', r.status === 400);
r = await req('/api/guardar', { method: 'POST', cookie, json: { contenido: { direccion: 'Calle 1\nValledupar' } } });
pub = await text('/');
check('texto de varias lineas usa <br>', r.status === 200 && /Calle 1<br>Valledupar/.test(pub));

console.log('\n== Fotos ==');
const png = makePng();
r = await req('/api/img', { method: 'POST', cookie, headers: { 'Content-Type': 'image/png' }, body: png });
const up = await r.json();
check('subir PNG valido -> id', r.status === 200 && Number.isInteger(up.id), JSON.stringify(up));
const got = await req('/img/' + up.id);
const gotBytes = Buffer.from(await got.arrayBuffer());
check('/img/:id devuelve la misma foto', got.status === 200 && gotBytes.equals(png), `status ${got.status}, ${gotBytes.length}/${png.length} bytes`);
check('tipo correcto', got.headers.get('content-type') === 'image/png');
check('Cache-Control largo e inmutable', /max-age=31536000/.test(got.headers.get('cache-control') || '') && /immutable/.test(got.headers.get('cache-control') || ''));
const up2 = await (await req('/api/img', { method: 'POST', cookie, headers: { 'Content-Type': 'image/png' }, body: png })).json();
check('cada subida genera un id nuevo', up2.id !== up.id, `${up.id} vs ${up2.id}`);
check('SVG rechazado (415)', (await req('/api/img', { method: 'POST', cookie, headers: { 'Content-Type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'.padEnd(200) })).status === 415);
check('tipo declarado falso rechazado (415)', (await req('/api/img', { method: 'POST', cookie, headers: { 'Content-Type': 'image/png' }, body: Buffer.from('<html>'.padEnd(300, 'x')) })).status === 415);
check('foto gigante rechazada (413)', (await req('/api/img', { method: 'POST', cookie, headers: { 'Content-Type': 'image/png' }, body: Buffer.concat([png.subarray(0, 12), Buffer.alloc(700 * 1024)]) })).status === 413);
check('/img/999999 -> 404', (await req('/img/999999')).status === 404);
r = await req('/api/guardar', { method: 'POST', cookie, json: { contenido: { img_logo: String(up.id) } } });
pub = await text('/');
check('cambiar la foto del logo -> se ve en la pagina publica', r.status === 200 && count(pub, new RegExp('/img/' + up.id, 'g')) >= 3, `apariciones: ${count(pub, new RegExp('/img/' + up.id, 'g'))}`);
r = await req('/api/guardar', { method: 'POST', cookie, json: { contenido: { img_logo: '987654' } } });
check('foto inexistente -> 400', r.status === 400);

console.log('\n== Listas (servicios) ==');
const servicios = base.listas.servicios;
const nuevo = { ...servicios[servicios.length - 1], titulo: 'Servicio <b>nuevo</b>', puntos: 'Punto uno\nPunto dos' };
r = await req('/api/guardar', { method: 'POST', cookie, json: { listas: { servicios: [...servicios, nuevo] } } });
pub = await text('/');
check('agregar elemento -> 7 tarjetas', r.status === 200 && count(pub, /class="service-card glass-card"/g) === 7, String(count(pub, /class="service-card glass-card"/g)));
check('el titulo nuevo se escapa', pub.includes('Servicio &lt;b&gt;nuevo&lt;/b&gt;') && !pub.includes('<b>nuevo</b>'));
check('las viñetas nuevas se dibujan', pub.includes('Punto uno') && pub.includes('Punto dos'));
check('el enlace de WhatsApp del servicio usa el titulo', pub.includes('para%20Servicio%20%3Cb%3Enuevo'));
const reordered = [nuevo, ...servicios];
r = await req('/api/guardar', { method: 'POST', cookie, json: { listas: { servicios: reordered } } });
pub = await text('/');
const titles = [...pub.matchAll(/class="service-card-title" data-field="titulo">([^<]*)</g)].map((m) => m[1]);
check('reordenar (el nuevo sube al primer lugar)', titles[0].startsWith('Servicio &lt;b&gt;'), titles[0]);
check('el resto conserva su orden', titles[1] === 'Topografía Planialtimétrica', titles[1]);
r = await req('/api/guardar', { method: 'POST', cookie, json: { listas: { servicios } } });
pub = await text('/');
check('borrar el elemento -> vuelven 6', r.status === 200 && count(pub, /class="service-card glass-card"/g) === 6);
r = await req('/api/guardar', { method: 'POST', cookie, json: { listas: { servicios: [] } } });
check('lista vacia -> 400', r.status === 400);
r = await req('/api/guardar', { method: 'POST', cookie, json: { listas: { inventada: [{}] } } });
check('lista desconocida -> 400', r.status === 400);
const galeria = base.listas.galeria;
r = await req('/api/guardar', { method: 'POST', cookie, json: { listas: { galeria: [{ ...galeria[0], foto: String(up.id) }, ...galeria.slice(1)] } } });
pub = await text('/');
check('foto de un elemento de galeria cambiada', r.status === 200 && pub.includes(`src="/img/${up.id}"`));
r = await req('/api/guardar', { method: 'POST', cookie, json: { listas: { galeria: [{ ...galeria[0], foto: 'https://malo.example/x.png' }] } } });
check('foto con URL externa -> 400', r.status === 400);

console.log('\n== Ajustes (telefono, WhatsApp, Facebook, Google) ==');
r = await req('/api/guardar', { method: 'POST', cookie, json: { contenido: { whatsapp_numero: '573001112233', telefono_numero: '573004445566', facebook_url: 'https://www.facebook.com/otra', seo_titulo: 'Titulo de prueba' } } });
pub = await text('/');
check('guardar ajustes -> 200', r.status === 200);
check('WhatsApp cambia en todos los enlaces y en el body', pub.includes('data-wa="573001112233"') && !pub.includes('wa.me/573205931159') && pub.includes('wa.me/573001112233?text='));
check('el enlace de WhatsApp de los servicios usa el numero nuevo', pub.includes('https://wa.me/573001112233?text=Hola,%20solicito'));
check('telefono cambia', pub.includes('href="tel:+573004445566"') && !pub.includes('tel:+573205931159'));
check('Facebook cambia', pub.includes('href="https://www.facebook.com/otra"'));
check('titulo de Google cambia', pub.includes('<title>Titulo de prueba</title>'));
check('telefono invalido -> 400', (await req('/api/guardar', { method: 'POST', cookie, json: { contenido: { telefono_numero: '12ab' } } })).status === 400);
check('Facebook sin https -> 400', (await req('/api/guardar', { method: 'POST', cookie, json: { contenido: { facebook_url: 'javascript:alert(1)' } } })).status === 400);

console.log('\n== Restaurar la base de pruebas ==');
const orig = base; // lo que habia al empezar
const restoreContent = {
  hero_titulo_2: originalTitle ? originalTitle.replace(/&amp;/g, '&') : 'Ingeniería & Topografía',
  direccion: 'Mz. 3, Casa 15, Barrio Don Alberto\nValledupar, Cesar, Colombia',
  img_logo: '',
  whatsapp_numero: '573205931159',
  telefono_numero: '573205931159',
  facebook_url: 'https://www.facebook.com/profile.php?id=100066559567309',
  seo_titulo: 'INJER S.A.S. | Ingeniería & Topografía en Valledupar, Cesar',
};
r = await req('/api/guardar', { method: 'POST', cookie, json: { contenido: restoreContent, listas: { servicios: orig.listas.servicios, galeria: orig.listas.galeria } } });
check('restaurado', r.status === 200, await r.clone().text());
const home2 = await text('/');
check('la pagina vuelve a ser la original', home2.includes('wa.me/573205931159') && !home2.includes('Titulo de prueba'));

console.log('\n== Cerrar sesion ==');
const out = await req('/api/logout', { method: 'POST', cookie });
check('logout -> 200 y borra la cookie', out.status === 200 && /Max-Age=0/i.test(out.headers.get('set-cookie') || ''));
check('la sesion ya no sirve', (await req('/api/guardar', { method: 'POST', cookie, json: { contenido: {} } })).status === 401);
check('/admin vuelve a pedir login', (await text('/admin', { cookie })).includes('id="f"'));

console.log(`\n${passed} correctas, ${failed} con falla`);
process.exit(failed ? 1 : 0);
