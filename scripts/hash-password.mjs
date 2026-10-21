// Genera el hash PBKDF2 de la contraseña del administrador.
//   npm run clave        -> imprime el hash (para "wrangler secret put ADMIN_PASSWORD_HASH")
//   npm run clave:dev    -> además crea .dev.vars para probar en local con "wrangler dev"
import crypto from 'node:crypto';
import fs from 'node:fs';

// 100000 es el máximo que permite WebCrypto en Cloudflare Workers. Solo bájalo (ITERACIONES=50000)
// si en el plan gratis el login da "Error 1102" (ver GUIA.md, sección de problemas).
const ITERATIONS = Math.min(100000, Math.max(1000, parseInt(process.env.ITERACIONES || '100000', 10)));

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => (data += c));
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0]));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(buf);
        }
        if (c === '\u0003') process.exit(1);
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

const pw = await askHidden('Escribe la nueva contraseña (no se ve mientras escribes): ');
if (pw.length < 10) {
  console.error('\nLa contraseña debe tener al menos 10 caracteres.');
  process.exit(1);
}
if (process.stdin.isTTY) {
  const again = await askHidden('Repítela: ');
  if (again !== pw) {
    console.error('\nNo coinciden. Vuelve a intentarlo.');
    process.exit(1);
  }
}

const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(pw, salt, ITERATIONS, 32, 'sha256');
const stored = `pbkdf2-sha256$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;

console.log('\nHash generado (cópialo completo):\n');
console.log(stored + '\n');

if (process.argv.includes('--dev')) {
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync('.dev.vars', `ADMIN_PASSWORD_HASH="${stored}"\nSESSION_SECRET="${secret}"\n`);
  console.log('Se creó .dev.vars para probar en local (no se sube a git).');
}
