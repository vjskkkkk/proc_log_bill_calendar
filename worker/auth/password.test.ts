import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes with a random salt and verifies', async () => {
    const h1 = await hashPassword('secret-pass');
    const h2 = await hashPassword('secret-pass');
    expect(h1).not.toBe(h2);
    expect(h1.startsWith('pbkdf2$100000$')).toBe(true);
    expect(await verifyPassword('secret-pass', h1)).toBe(true);
    expect(await verifyPassword('wrong', h1)).toBe(false);
    expect(await verifyPassword('secret-pass', 'garbage')).toBe(false);
  });
});
