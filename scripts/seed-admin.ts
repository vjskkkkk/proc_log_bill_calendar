// Creates (or resets) an admin user directly in D1 via wrangler, for local dev or first production seed.
// Usage: npm run seed:admin -- <email> <password> [name] [--remote]
import { execSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const remote = process.argv.includes('--remote');
const [email, password, name = 'Administrator'] = args;
if (!email || !password) {
  console.error('Usage: npm run seed:admin -- <email> <password> [name] [--remote]');
  process.exit(1);
}

const ITER = 100_000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password).buffer as ArrayBuffer, 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt.buffer as ArrayBuffer, iterations: ITER }, key, 256);
const hash = `pbkdf2$${ITER}$${Buffer.from(salt).toString('base64')}$${Buffer.from(bits).toString('base64')}`;
const id = crypto.randomUUID();
const esc = (s: string) => s.replace(/'/g, "''");
const sql =
  `INSERT INTO users (id, email, name, role, password_hash, must_change_password, active, created_at) ` +
  `VALUES ('${id}', '${esc(email.toLowerCase())}', '${esc(name)}', 'admin', '${hash}', 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ` +
  `ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin', active = 1, must_change_password = 0;`;
execSync(`npx wrangler d1 execute koochie-calendar ${remote ? '--remote' : '--local'} --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
console.log(`Admin ${email} ready (${remote ? 'remote' : 'local'}).`);
