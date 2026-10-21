// Carga el contenido ACTUAL de public/index.html en D1 (textos, ajustes y listas).
// Es seguro repetirlo: no pisa lo que el cliente ya editó.
//   npm run seed:local   -> base local de "wrangler dev"
//   npm run seed         -> base real en Cloudflare
import { parse } from 'node-html-parser';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const target = process.argv.includes('--remote') ? '--remote' : '--local';
const html = fs.readFileSync('public/index.html', 'utf8');
const root = parse(html, { comment: false });

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const clean = (s) => s.replace(/ /g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/[ \t]+/g, ' ').trim();
const inTemplate = (el) => {
  for (let p = el.parentNode; p; p = p.parentNode) if (p.rawTagName === 'template') return true;
  return false;
};
// texto plano del elemento; los <br> pasan a salto de línea
const textOf = (el) => clean(el.childNodes.map((n) => (n.rawTagName === 'br' ? '\n' : n.text)).join(''));
const digits = (s) => String(s || '').replace(/\D/g, '');

const contenido = {};
const add = (k, v) => {
  if (!(k in contenido) && v !== undefined && v !== '') contenido[k] = v;
};

// Textos (data-edit). Si una clave aparece varias veces se toma la primera.
for (const el of root.querySelectorAll('[data-edit]')) {
  if (!inTemplate(el)) add(el.getAttribute('data-edit'), textOf(el));
}

// Ajustes: SEO y enlaces
add('seo_titulo', root.querySelector('title')?.text.trim());
add('seo_descripcion', root.querySelector('meta[name="description"]')?.getAttribute('content'));
add('whatsapp_numero', root.querySelector('body')?.getAttribute('data-wa'));
add('telefono_numero', digits(root.querySelector('a[data-link="telefono"]')?.getAttribute('href')));
add('facebook_url', root.querySelector('a[data-link="facebook"]')?.getAttribute('href'));

// Listas
const listas = {};
for (const container of root.querySelectorAll('[data-list]')) {
  const name = container.getAttribute('data-list');
  const items = container.querySelectorAll('[data-item]').filter((it) => !inTemplate(it));
  listas[name] = items.map((item) => {
    const o = {};
    for (const f of item.querySelectorAll('[data-field]')) o[f.getAttribute('data-field')] = textOf(f);
    for (const f of item.querySelectorAll('[data-field-class]')) {
      o[f.getAttribute('data-field-class')] = (f.getAttribute('class') || '').trim();
    }
    for (const f of item.querySelectorAll('[data-field-img]')) {
      o[f.getAttribute('data-field-img')] = (f.getAttribute('src') || '').replace(/^\.\//, '/');
      if (f.getAttribute('data-field-alt')) o[f.getAttribute('data-field-alt')] = f.getAttribute('alt') || '';
    }
    for (const f of item.querySelectorAll('[data-field-lines]')) {
      o[f.getAttribute('data-field-lines')] = f.querySelectorAll('li').map((li) => clean(li.text)).join('\n');
    }
    return o;
  });
}

// SQL: solo inserta lo que todavía no existe
const stmts = [];
for (const [k, v] of Object.entries(contenido)) {
  stmts.push(`INSERT OR IGNORE INTO contenido (clave, valor) VALUES (${q(k)}, ${q(v)});`);
}
for (const [name, items] of Object.entries(listas)) {
  items.forEach((campos, i) => {
    stmts.push(
      `INSERT INTO listas (seccion, orden, campos) SELECT ${q(name)}, ${i}, ${q(JSON.stringify(campos))} ` +
        `WHERE NOT EXISTS (SELECT 1 FROM contenido WHERE clave = ${q('lista_' + name)});`
    );
  });
  stmts.push(`INSERT OR IGNORE INTO contenido (clave, valor) VALUES (${q('lista_' + name)}, '1');`);
}

fs.writeFileSync('scripts/seed.generated.sql', stmts.join('\n') + '\n');
console.log(`Textos: ${Object.keys(contenido).length}  |  Listas: ${Object.entries(listas).map(([n, a]) => `${n} (${a.length})`).join(', ')}`);

const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'injer-db', target, '--file=scripts/seed.generated.sql'], {
  stdio: 'inherit',
  shell: true,
});
process.exit(r.status ?? 1);
