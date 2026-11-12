// Admin auth for /admin.
//
// This repo is public, so nothing secret lives in it. The admin password is a long
// random string (~116 bits), stored here only as a salted SHA-256. A fast hash is safe
// for a password that random (guessing is hopeless however fast each guess is), and it
// keeps login inside the free-tier CPU budget. Never set a short, human-chosen password:
// use scripts/hash-password.mjs, which generates one.
//
// Sessions are random tokens kept in the store, so no signing secret is needed.
// To rotate without a code change, set ADMIN_PASSWORD_HASH in the host's environment.

import crypto from "node:crypto";

export const ADMIN_USER = "tech";
const DEFAULT_HASH = "sha256$dt0x8tfSCjmUTWnYDnD7oQ$d58eec01011fc976cdc088ac94e20f8f3d3d707354286383db867af0f3e12006";
export const SESSION_TTL_S = 12 * 60 * 60;

const sha = (salt, password) => crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  return `sha256$${salt}$${sha(salt, password)}`;
}

export function verifyPassword(password, stored) {
  stored = stored || (typeof process !== "undefined" && process.env?.ADMIN_PASSWORD_HASH) || DEFAULT_HASH;
  const [kind, salt, hex] = String(stored).split("$");
  if (kind !== "sha256" || !salt || !/^[0-9a-f]{64}$/.test(hex || "") || typeof password !== "string" || !password) return false;
  return crypto.timingSafeEqual(Buffer.from(sha(salt, password), "hex"), Buffer.from(hex, "hex"));
}

const tokenKey = (token) => `session/${crypto.createHash("sha256").update(token).digest("hex")}`;
const bearer = (req) => /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(req.headers.get("authorization") || "")?.[1];

export async function createSession(store) {
  const token = crypto.randomBytes(32).toString("base64url");
  await store.setJSON(tokenKey(token), { exp: Date.now() + SESSION_TTL_S * 1000 }, { ttl: SESSION_TTL_S });
  return token;
}

export async function checkSession(store, req) {
  const t = bearer(req);
  if (!t) return false;
  const s = await store.get(tokenKey(t), { type: "json" });
  return Boolean(s && s.exp > Date.now());
}

export async function endSession(store, req) {
  const t = bearer(req);
  if (t) await store.delete(tokenKey(t));
}

/**
 * Fixed-window counter in the store. Not transactional (and KV is eventually
 * consistent), so a burst can slip a few over the limit; fine for spam and
 * password-guess control.
 */
export async function rateLimited(store, bucket, ip, limit, windowMs) {
  const win = Math.floor(Date.now() / windowMs);
  const who = crypto.createHash("sha256").update(String(ip || "unknown")).digest("hex").slice(0, 24);
  const key = `rl/${bucket}/${who}/${win}`;
  const cur = (await store.get(key, { type: "json" })) || { n: 0 };
  if (cur.n >= limit) return true;
  await store.setJSON(key, { n: cur.n + 1 }, { ttl: Math.max(60, Math.ceil(windowMs / 1000) * 2) });
  return false;
}
