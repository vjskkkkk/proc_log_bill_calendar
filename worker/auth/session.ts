import { and, eq, gt } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { db, nowIso, schema } from '../db/client';
import type { Env } from '../env';
import type { Role, UserPublic } from '@shared/types';

// Not BOQ Maker's `koochie_session`: on localhost both apps share one cookie jar (cookies ignore the port).
export const COOKIE_NAME = 'koochie_calendar_session';
const SESSION_DAYS = 30;

export interface SessionUser extends UserPublic {
  sessionId: string;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(secret: string, value: string): Promise<string> {
  if (!secret) throw new Error('SESSION_SECRET is not set on this Worker (Settings → Variables and Secrets)');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return b64url(new Uint8Array(sig));
}

/** Constant-time comparison of two signatures. */
function sameString(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

function cookieSecure(c: Context<any>): boolean {
  const mode = (c.env as Env).COOKIE_SECURE ?? 'auto';
  if (mode === 'true') return true;
  if (mode === 'false') return false;
  return new URL(c.req.url).protocol === 'https:';
}

export function toPublic(u: typeof schema.users.$inferSelect): UserPublic {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as Role,
    mustChangePassword: u.mustChangePassword,
    active: u.active,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

export async function createSession(c: Context<any>, userId: string): Promise<void> {
  const id = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db((c.env as Env).DB).insert(schema.sessions).values({ id, userId, expiresAt: expires.toISOString(), createdAt: nowIso() });
  const sig = await sign((c.env as Env).SESSION_SECRET, id);
  setCookie(c, COOKIE_NAME, `${id}.${sig}`, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: cookieSecure(c),
    path: '/',
    expires,
  });
}

export async function readSession(c: Context<any>): Promise<SessionUser | null> {
  const raw = getCookie(c, COOKIE_NAME);
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return null;
  const id = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!sameString(sig, await sign((c.env as Env).SESSION_SECRET, id))) return null;
  const rows = await db((c.env as Env).DB)
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, nowIso())))
    .limit(1);
  const row = rows[0];
  if (!row || !row.user.active) return null;
  return { ...toPublic(row.user), sessionId: row.session.id };
}

export async function destroySession(c: Context<any>, sessionId: string | undefined): Promise<void> {
  if (sessionId) await db((c.env as Env).DB).delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

export async function destroyAllSessions(env: Env, userId: string): Promise<void> {
  await db(env.DB).delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}
