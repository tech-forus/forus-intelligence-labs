// Admin auth for /admin.
//
// This repo is public, so nothing secret lives in it. The admin password is
// stored only as an scrypt hash (of a long random password, so the hash cannot
// be brute-forced). Sessions are random tokens kept in the blob store, so no
// signing secret is needed either.
//
// To rotate the password without a code change, set ADMIN_PASSWORD_HASH in the
// Netlify site's environment to a new `scrypt$N$salt$hash` string
// (generate with: node scripts/hash-password.mjs "<new password>").

import crypto from "node:crypto";

export const ADMIN_USER = "tech";
const DEFAULT_HASH = "scrypt$32768$iQUigKTgemhbQ7u33REEiQ==$sO2AzNZzQRAgnlxv6FZqVoRTUb+mcUk1S9H+pya83e8=";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function hashPassword(password, N = 32768) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(password, salt, 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${salt.toString("base64")}$${h.toString("base64")}`;
}

export function verifyPassword(password, stored = process.env.ADMIN_PASSWORD_HASH || DEFAULT_HASH) {
  const [kind, n, salt, hash] = String(stored).split("$");
  if (kind !== "scrypt" || !salt || !hash || typeof password !== "string" || !password) return false;
  const expected = Buffer.from(hash, "base64");
  const got = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n), r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(got, expected);
}

const tokenKey = (token) => `session/${crypto.createHash("sha256").update(token).digest("hex")}`;

export async function createSession(store) {
  const token = crypto.randomBytes(32).toString("base64url");
  await store.setJSON(tokenKey(token), { exp: Date.now() + SESSION_TTL_MS });
  return token;
}

export async function checkSession(store, req) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(req.headers.get("authorization") || "");
  if (!m) return false;
  const s = await store.get(tokenKey(m[1]), { type: "json" });
  return Boolean(s && s.exp > Date.now());
}

export async function endSession(store, req) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(req.headers.get("authorization") || "");
  if (m) await store.delete(tokenKey(m[1]));
}

/**
 * Fixed-window counter in the blob store. Blobs are not transactional, so a burst
 * can slip a couple over the limit; that is fine for spam and password-guess control.
 */
export async function rateLimited(store, bucket, ip, limit, windowMs) {
  const win = Math.floor(Date.now() / windowMs);
  const who = crypto.createHash("sha256").update(String(ip || "unknown")).digest("hex").slice(0, 24);
  const key = `rl/${bucket}/${who}/${win}`;
  const cur = (await store.get(key, { type: "json" })) || { n: 0 };
  if (cur.n >= limit) return true;
  await store.setJSON(key, { n: cur.n + 1, until: (win + 1) * windowMs });
  return false;
}
