// Crea la base D1 "injer-db" (si no existe) y escribe su database_id en wrangler.toml.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const NAME = 'injer-db';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const run = (args) => spawnSync('npx', ['wrangler', ...args], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] });

function findId() {
  const r = run(['d1', 'info', NAME, '--json']);
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    return j.uuid || j.database_id || j.id || null;
  } catch {
    return (r.stdout.match(UUID) || [])[0] || null;
  }
}

let id = findId();
if (!id) {
  console.log(`Creando la base de datos "${NAME}"...`);
  const c = run(['d1', 'create', NAME]);
  process.stdout.write(c.stdout || '');
  process.stderr.write(c.stderr || '');
  id = findId() || ((c.stdout || '').match(UUID) || [])[0];
}
if (!id) {
  console.error('\nNo pude obtener el id de la base. ¿Hiciste "npx wrangler login"? Revisa los mensajes de arriba.');
  process.exit(1);
}

let toml = fs.readFileSync('wrangler.toml', 'utf8');
toml = toml.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${id}"`);
fs.writeFileSync('wrangler.toml', toml);
console.log(`\nListo. database_id = ${id} guardado en wrangler.toml`);
