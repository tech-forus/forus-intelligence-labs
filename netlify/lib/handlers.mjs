// /api/careers/* request router. Storage is injected so tests can use an in-memory store.
//
// Blob layout (one store, "careers"):
//   app/<id>       application JSON (includes resume text + scores)
//   resume/<id>    the original resume bytes, metadata { fileName, mime, size }
//   session/<sha>  admin sessions        rl/...  rate-limit counters

import crypto from "node:crypto";
import { normaliseApplication, ROLES, STATUSES } from "./validate.mjs";
import { sniffResume, typeInfo, extractText, MAX_RESUME_BYTES } from "./files.mjs";
import { scoreApplication } from "./scoring.mjs";
import { ADMIN_USER, verifyPassword, createSession, checkSession, endSession, rateLimited } from "./auth.mjs";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const HOUR = 60 * 60 * 1000;

// ---------------------------------------------------------------- public

async function apply(req, { store, ip }) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_RESUME_BYTES + 200_000) return json({ error: "Resume is too large. Keep it under 4 MB." }, 413);

  let fd;
  try {
    fd = await req.formData();
  } catch {
    return json({ error: "Could not read the form. Please try again." }, 400);
  }

  // honeypot: real people never see or fill this field
  if (String(fd.get("website") || "").trim()) return json({ ok: true, id: "received" });

  if (await rateLimited(store, "apply", ip, 5, HOUR)) {
    return json({ error: "Too many applications from this network. Try again in an hour." }, 429);
  }

  const { application, errors } = normaliseApplication(fd);

  const file = fd.get("resume");
  let bytes = null;
  let kind = null;
  if (!file || typeof file === "string" || !file.size) {
    errors.push("Attach your resume (PDF or Word).");
  } else if (file.size > MAX_RESUME_BYTES) {
    errors.push("Resume is too large. Keep it under 4 MB.");
  } else {
    bytes = new Uint8Array(await file.arrayBuffer());
    kind = sniffResume(bytes);
    if (!kind) errors.push("Resume must be a PDF or Word document.");
  }
  if (errors.length) return json({ error: errors[0], errors }, 400);

  const id = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`;
  const resumeText = await extractText(bytes, kind);
  const scores = scoreApplication(application, resumeText);
  const info = typeInfo(kind);
  const safeName = String(file.name || `resume.${info.ext}`).replace(/[^\w.\- ]+/g, "_").slice(0, 120);

  await store.set(`resume/${id}`, bytes, { metadata: { fileName: safeName, mime: info.mime, size: bytes.length } });
  await store.setJSON(`app/${id}`, {
    id,
    ...application,
    roleTitle: ROLES[application.role],
    resume: { fileName: safeName, mime: info.mime, size: bytes.length, textChars: resumeText.length },
    resumeText,
    scores,
    status: "new",
    starred: false,
    notes: "",
    submittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return json({ ok: true, id });
}

// ---------------------------------------------------------------- admin

async function login(req, { store, ip }) {
  if (await rateLimited(store, "login", ip, 8, 15 * 60 * 1000)) {
    return json({ error: "Too many attempts. Wait 15 minutes." }, 429);
  }
  let body = {};
  try { body = await req.json(); } catch { /* empty */ }
  const userOk = String(body.username || "").trim().toLowerCase() === ADMIN_USER;
  const passOk = verifyPassword(String(body.password || ""));
  if (!userOk || !passOk) return json({ error: "Wrong username or password." }, 401);
  return json({ token: await createSession(store) });
}

const summary = ({ resumeText, ...a }) => a;

async function listApps(store) {
  const { blobs } = await store.list({ prefix: "app/" });
  const out = [];
  for (let i = 0; i < blobs.length; i += 25) {
    const batch = await Promise.all(blobs.slice(i, i + 25).map((b) => store.get(b.key, { type: "json" })));
    for (const a of batch) if (a) out.push(summary(a));
  }
  out.sort((x, y) => (y.submittedAt || "").localeCompare(x.submittedAt || ""));
  return out;
}

async function admin(req, ctx, rest) {
  const { store } = ctx;
  if (rest === "login" && req.method === "POST") return login(req, ctx);
  if (!(await checkSession(store, req))) return json({ error: "Signed out. Log in again." }, 401);

  if (rest === "logout" && req.method === "POST") {
    await endSession(store, req);
    return json({ ok: true });
  }
  if (rest === "applications" && req.method === "GET") {
    return json({ applications: await listApps(store), statuses: STATUSES });
  }

  const m = /^applications\/([a-z0-9-]{6,40})(\/resume)?$/.exec(rest);
  if (!m) return json({ error: "Not found" }, 404);
  const [, id, wantsResume] = m;

  if (wantsResume && req.method === "GET") {
    const r = await store.getWithMetadata(`resume/${id}`, { type: "arrayBuffer" });
    if (!r) return json({ error: "Resume not found" }, 404);
    const name = r.metadata?.fileName || "resume";
    return new Response(r.data, {
      headers: {
        "content-type": r.metadata?.mime || "application/octet-stream",
        "content-disposition": `inline; filename="${name.replace(/"/g, "")}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const key = `app/${id}`;
  const app = await store.get(key, { type: "json" });
  if (!app) return json({ error: "Application not found" }, 404);

  if (req.method === "GET") return json({ application: app });

  if (req.method === "PATCH") {
    let body = {};
    try { body = await req.json(); } catch { /* empty */ }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return json({ error: "Unknown status" }, 400);
      app.status = body.status;
    }
    if (body.notes !== undefined) app.notes = String(body.notes).slice(0, 5000);
    if (body.starred !== undefined) app.starred = Boolean(body.starred);
    app.updatedAt = new Date().toISOString();
    await store.setJSON(key, app);
    return json({ application: summary(app) });
  }

  if (req.method === "DELETE") {
    await store.delete(key);
    await store.delete(`resume/${id}`);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

// ---------------------------------------------------------------- entry

export async function handle(req, ctx) {
  const path = new URL(req.url).pathname.replace(/^\/api\/careers\/?/, "").replace(/\/+$/, "");
  try {
    if (path === "apply" && req.method === "POST") return await apply(req, ctx);
    if (path.startsWith("admin/")) return await admin(req, ctx, path.slice(6));
    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error("[careers] unhandled:", e);
    return json({ error: "Something went wrong on our side. Please try again." }, 500);
  }
}
