// Usage: node scripts/hash-password.mjs
// Generates a new long random admin password and its hash. Put the hash in
// ADMIN_PASSWORD_HASH (Cloudflare Worker -> Settings -> Variables and secrets), or in
// DEFAULT_HASH in lib/careers/auth.mjs, and keep the password in a password manager.
// Passwords are always generated, never typed: the fast hash is only safe for random ones.
import crypto from "node:crypto";
import { hashPassword } from "../lib/careers/auth.mjs";

const A = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
let p = "";
for (const b of crypto.randomBytes(20)) p += A[b % A.length];
p = p.match(/.{5}/g).join("-");
console.log("password:", p);
console.log("hash:    ", hashPassword(p));
