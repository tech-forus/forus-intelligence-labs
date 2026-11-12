// /api/careers/* request router + the screening queue. Storage is injected so tests can use
// an in-memory store.
//
// Store layout:
//   app/<id>        application JSON (resume text, scores, screening decision)
//   resume/<id>     the original resume bytes, metadata { fileName, mime, size }
//   rejection/<id>  discarded application: contact, marks, scores, reasons (no resume)
//   mailq/<id>      pending action { id, kind: regret|discard|closing|assignment, dueAt, tries, manual? }
//   assignment/<role>, assignment-file/<role>   take-home assignment settings + PDF (assignment.mjs)
//   mailcount/<day> emails sent that day (cap)
//   session/<sha>   admin sessions        rl/...  rate-limit counters
//
// The store needs: set(k, bytes, {metadata}), setJSON(k, obj, {ttl}), get(k, {type}),
// getWithMetadata(k, {type}), delete(k), list({prefix}) -> {blobs:[{key}]}.

import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { normaliseApplication, ROLES, STATUSES } from "./validate.mjs";
import { sniffResume, typeInfo, tidyText, MAX_RESUME_BYTES } from "./files.mjs";
import { scoreApplication } from "./scoring.mjs";
import { decide, ACTION_DELAY_HOURS, MAIL_CAP_PER_RUN, MAIL_CAP_PER_DAY, ACADEMIC_BAR } from "./policy.mjs";
import { regretEmail, closingEmail, sendMail } from "./mailer.mjs";
import {
  getAssignment, saveAssignment, getAssignmentFile, qualifiesForAssignment, assignmentEmail, deadlineDate,
  assignmentRoles, MAX_ASSIGNMENT_BYTES,
} from "./assignment.mjs";
import { ADMIN_USER, verifyPassword, createSession, checkSession, endSession, rateLimited } from "./auth.mjs";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const HOUR = 60 * 60 * 1000;
const now = () => Date.now();

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

  const id = `${now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`;
  // text was read from the file in the applicant's browser (see files.mjs)
  const resumeText = tidyText(fd.get("resumeText"));
  const scores = scoreApplication(application, resumeText);
  const screening = decide(application, scores, resumeText.length);
  const info = typeInfo(kind);
  const safeName = String(file.name || `resume.${info.ext}`).replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const stamp = new Date().toISOString();

  const app = {
    id,
    ...application,
    roleTitle: ROLES[application.role],
    resume: { fileName: safeName, mime: info.mime, size: bytes.length, textChars: resumeText.length },
    resumeText,
    scores,
    screening: { ...screening, decidedAt: stamp },
    status: screening.action === "keep" ? "new" : "below-bar",
    starred: false,
    notes: "",
    submittedAt: stamp,
    updatedAt: stamp,
  };
  if (screening.action !== "keep") {
    const dueAt = new Date(now() + ACTION_DELAY_HOURS * HOUR).toISOString();
    app.pending = { kind: screening.action, dueAt };
    await store.setJSON(`mailq/${id}`, { id, kind: screening.action, dueAt, tries: 0 });
  } else if (qualifiesForAssignment(app)) {
    // met the bar: the take-home assignment goes out on the next queue run (hourly),
    // so the admin can still cancel it from /admin until then
    const cfg = await getAssignment(store, app.role);
    if (cfg?.enabled && (await getAssignmentFile(store, app.role))) {
      const dueAt = new Date(now()).toISOString();
      app.pending = { kind: "assignment", dueAt };
      await store.setJSON(`mailq/${id}`, { id, kind: "assignment", dueAt, tries: 0 });
    }
  }

  await store.set(`resume/${id}`, bytes, { metadata: { fileName: safeName, mime: info.mime, size: bytes.length } });
  await store.setJSON(`app/${id}`, app);

  // the applicant only ever sees "received"; screening is internal
  return json({ ok: true, id });
}

// ---------------------------------------------------------------- screening queue

function rejectionRecord(app) {
  return {
    id: app.id,
    fullName: app.fullName, email: app.email, phone: app.phone, city: app.city,
    role: app.role, roleTitle: app.roleTitle,
    degree: app.degree, branch: app.branch, college: app.college, gradYear: app.gradYear,
    experienceYears: app.experienceYears, currentRole: app.currentRole,
    class10: app.class10, class12: app.class12, cgpa: app.cgpa,
    skills: app.skills, domains: app.domains, links: app.links,
    built: (app.built || "").slice(0, 600),
    academics: app.screening?.academics,
    scores: {
      freightcompare: app.scores?.freightcompare?.score, forusbiz: app.scores?.forusbiz?.score,
      hardware: app.scores?.hardware?.score, tags: app.scores?.tags,
    },
    reasons: app.screening?.reasons || [],
    resumeFile: app.resume?.fileName,
    submittedAt: app.submittedAt,
    discardedAt: new Date().toISOString(),
    mail: { status: "queued" },
  };
}

const dayKey = () => `mailcount/${new Date().toISOString().slice(0, 10)}`;

async function mailFor(store, env, item) {
  const isClosing = item.kind === "closing";
  const key = isClosing ? `rejection/${item.id}` : `app/${item.id}`;
  const rec = await store.get(key, { type: "json" });
  if (!rec) return { drop: true };
  const tpl = isClosing ? closingEmail(rec) : regretEmail(rec);
  const res = await sendMail(env, rec.email, tpl);
  const at = new Date().toISOString();
  rec.mail = res.sent
    ? { kind: item.kind, status: "sent", at, messageId: res.messageId }
    : { kind: item.kind, status: res.skipped ? "waiting" : "failed", at, note: res.skipped || res.error };
  if (!isClosing && res.sent) rec.pending = null;
  rec.updatedAt = at;
  await store.setJSON(key, rec);
  return res;
}

/** Send the role's assignment PDF to one applicant. Same result shape as mailFor. */
async function sendAssignment(store, env, item) {
  const key = `app/${item.id}`;
  const app = await store.get(key, { type: "json" });
  if (!app) return { drop: true };
  if (app.assignment?.status === "sent") { // never twice
    if (app.pending?.kind === "assignment") { app.pending = null; await store.setJSON(key, app); }
    return { drop: true };
  }
  const at = new Date().toISOString();
  const cfg = await getAssignment(store, app.role);
  const file = cfg && (await getAssignmentFile(store, app.role));
  const stop = async (note) => {
    app.pending = null;
    app.assignment = { status: "not sent", note, at };
    app.updatedAt = at;
    await store.setJSON(key, app);
    return { drop: true };
  };
  if (!file) return stop("no assignment PDF uploaded for this role");
  if (!item.manual && !cfg.enabled) return stop("auto-send was turned off");

  const deadline = deadlineDate(now(), cfg.deadlineDays);
  const submitTo = env?.CAREERS_REPLY_TO || "tech@foruselectric.com";
  const tpl = assignmentEmail(app, cfg, deadline.label, submitTo);
  const name = file.metadata?.fileName || "Assignment.pdf";
  const res = await sendMail(env, app.email, {
    ...tpl,
    attachments: [{ name, content: Buffer.from(file.data).toString("base64") }],
  });
  if (res.sent) {
    app.assignment = {
      status: "sent", sentAt: at, deadline: deadline.iso, deadlineLabel: deadline.label,
      fileName: name, messageId: res.messageId, manual: Boolean(item.manual),
    };
    app.pending = null;
    if (app.status === "new" || app.status === "below-bar") app.status = "assignment-sent";
  } else {
    app.assignment = { status: res.skipped ? "waiting" : "failed", note: res.skipped || res.error, at };
    if (!res.skipped && (item.tries || 0) + 1 >= 5) app.pending = null;
  }
  app.updatedAt = at;
  await store.setJSON(key, app);
  return res;
}

/**
 * Run due screening actions. Called hourly by the cron trigger and from /admin.
 * @param {{ids?:string[], force?:boolean}} opts  ids: only these; force: ignore dueAt
 */
export async function processQueue(store, env, opts = {}) {
  const { blobs } = await store.list({ prefix: "mailq/" });
  const out = { discarded: 0, sent: 0, waiting: 0, failed: 0, capped: false };
  let sentThisRun = 0;
  const counter = (await store.get(dayKey(), { type: "json" })) || { n: 0 };

  for (const { key } of blobs) {
    const item = await store.get(key, { type: "json" });
    if (!item) continue;
    if (opts.ids && !opts.ids.includes(item.id)) continue;
    if (!opts.force && Date.parse(item.dueAt) > now()) continue;

    if (item.kind === "discard") {
      const app = await store.get(`app/${item.id}`, { type: "json" });
      if (app) {
        await store.setJSON(`rejection/${item.id}`, rejectionRecord(app));
        await store.delete(`resume/${item.id}`);
        await store.delete(`app/${item.id}`);
        out.discarded++;
      }
      // the closing email follows straight away, under the same caps
      item.kind = "closing";
      await store.setJSON(key, item);
    }

    if (sentThisRun >= MAIL_CAP_PER_RUN || counter.n >= MAIL_CAP_PER_DAY) { out.capped = true; continue; }
    const res = item.kind === "assignment" ? await sendAssignment(store, env, item) : await mailFor(store, env, item);
    if (res.drop || res.sent) {
      await store.delete(key);
      if (res.sent) { out.sent++; sentThisRun++; counter.n++; }
    } else if (res.skipped) {
      out.waiting++;
    } else {
      out.failed++;
      item.tries = (item.tries || 0) + 1;
      if (item.tries >= 5) await store.delete(key);
      else await store.setJSON(key, item);
    }
  }
  if (sentThisRun) await store.setJSON(dayKey(), counter, { ttl: 2 * 24 * 3600 });
  return out;
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

async function listPrefix(store, prefix, map = (x) => x) {
  const { blobs } = await store.list({ prefix });
  const out = [];
  for (let i = 0; i < blobs.length; i += 25) {
    const batch = await Promise.all(blobs.slice(i, i + 25).map((b) => store.get(b.key, { type: "json" })));
    for (const a of batch) if (a) out.push(map(a));
  }
  return out;
}

async function admin(req, ctx, rest) {
  const { store, env } = ctx;
  if (rest === "login" && req.method === "POST") return login(req, ctx);
  if (!(await checkSession(store, req))) return json({ error: "Signed out. Log in again." }, 401);

  if (rest === "logout" && req.method === "POST") {
    await endSession(store, req);
    return json({ ok: true });
  }
  if (rest === "applications" && req.method === "GET") {
    const applications = await listPrefix(store, "app/", summary);
    applications.sort((x, y) => (y.submittedAt || "").localeCompare(x.submittedAt || ""));
    return json({
      applications, statuses: STATUSES, bar: ACADEMIC_BAR, delayHours: ACTION_DELAY_HOURS,
      emailReady: Boolean(env?.CAREERS_BREVO_KEY && env?.CAREERS_FROM_EMAIL),
    });
  }
  if (rest === "rejections" && req.method === "GET") {
    const rejections = await listPrefix(store, "rejection/");
    rejections.sort((x, y) => (y.discardedAt || "").localeCompare(x.discardedAt || ""));
    return json({ rejections });
  }
  if (rest === "run-queue" && req.method === "POST") {
    return json({ result: await processQueue(store, env) });
  }

  if (rest === "assignments" && req.method === "GET") {
    const roles = {};
    for (const role of assignmentRoles()) {
      const cfg = await getAssignment(store, role);
      const f = await getAssignmentFile(store, role);
      roles[role] = {
        ...cfg, roleTitle: ROLES[role],
        file: f ? { fileName: f.metadata?.fileName, size: f.metadata?.size, uploadedAt: f.metadata?.uploadedAt } : null,
      };
    }
    return json({ roles, submitTo: env?.CAREERS_REPLY_TO || "tech@foruselectric.com" });
  }
  const as = /^assignments\/(software|hardware)(\/file|\/preview|\/test)?$/.exec(rest);
  if (as) return assignmentAdmin(req, ctx, as[1], as[2] || "");

  const rj = /^rejections\/([a-z0-9-]{6,40})$/.exec(rest);
  if (rj && req.method === "DELETE") {
    await store.delete(`rejection/${rj[1]}`);
    await store.delete(`mailq/${rj[1]}`);
    return json({ ok: true });
  }

  const m = /^applications\/([a-z0-9-]{6,40})(\/resume|\/cancel-action|\/run-action|\/send-assignment)?$/.exec(rest);
  if (!m) return json({ error: "Not found" }, 404);
  const [, id, sub] = m;

  if (sub === "/resume" && req.method === "GET") {
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

  if (sub === "/cancel-action" && req.method === "POST") {
    await store.delete(`mailq/${id}`);
    app.pending = null;
    app.screening = { ...app.screening, overridden: new Date().toISOString() };
    if (app.status === "below-bar") app.status = "new";
    app.updatedAt = new Date().toISOString();
    await store.setJSON(key, app);
    return json({ application: summary(app) });
  }
  if (sub === "/run-action" && req.method === "POST") {
    const result = await processQueue(store, env, { ids: [id], force: true });
    const after = await store.get(key, { type: "json" });
    return json({ result, application: after ? summary(after) : null });
  }

  if (sub === "/send-assignment" && req.method === "POST") {
    if (app.assignment?.status === "sent") return json({ error: "The assignment was already sent to this applicant." }, 409);
    if (!(await getAssignmentFile(store, app.role))) return json({ error: `No assignment PDF uploaded for ${ROLES[app.role]} yet.` }, 400);
    // replaces any other pending action (e.g. a "kept on file" email): we are inviting them instead
    const dueAt = new Date().toISOString();
    await store.setJSON(`mailq/${id}`, { id, kind: "assignment", dueAt, tries: 0, manual: true });
    app.pending = { kind: "assignment", dueAt };
    await store.setJSON(key, app);
    const result = await processQueue(store, env, { ids: [id], force: true });
    const after = await store.get(key, { type: "json" });
    return json({ result, application: after ? summary(after) : null });
  }

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
    await store.delete(`mailq/${id}`);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function assignmentAdmin(req, { store, env }, role, sub) {
  if (sub === "" && req.method === "PUT") {
    let body = {};
    try { body = await req.json(); } catch { /* empty */ }
    const r = await saveAssignment(store, role, body);
    if (r.error) return json({ error: r.error }, 400);
    if (r.settings.enabled && !(await getAssignmentFile(store, role))) {
      return json({ settings: r.settings, warning: "Auto-send is on, but no PDF is uploaded yet: nothing goes out until you upload one." });
    }
    return json({ settings: r.settings });
  }
  if (sub === "/file" && req.method === "PUT") {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) return json({ error: "Empty file." }, 400);
    if (bytes.length > MAX_ASSIGNMENT_BYTES) return json({ error: "PDF is too large (max 5 MB)." }, 413);
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return json({ error: "That is not a PDF." }, 400);
    let name = "Assignment.pdf";
    try { name = decodeURIComponent(req.headers.get("x-file-name") || name); } catch { /* keep default */ }
    name = name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "Assignment.pdf";
    if (!/\.pdf$/i.test(name)) name += ".pdf";
    const meta = { fileName: name, size: bytes.length, uploadedAt: new Date().toISOString() };
    await store.set(`assignment-file/${role}`, bytes, { metadata: meta });
    return json({ file: meta });
  }
  if (sub === "/file" && req.method === "GET") {
    const f = await getAssignmentFile(store, role);
    if (!f) return json({ error: "No PDF uploaded" }, 404);
    return new Response(f.data, {
      headers: {
        "content-type": "application/pdf", "cache-control": "no-store", "x-content-type-options": "nosniff",
        "content-disposition": `inline; filename="${String(f.metadata?.fileName || "Assignment.pdf").replace(/"/g, "")}"`,
      },
    });
  }
  const cfg = await getAssignment(store, role);
  const submitTo = env?.CAREERS_REPLY_TO || "tech@foruselectric.com";
  if (sub === "/preview" && req.method === "GET") {
    const tpl = assignmentEmail({ fullName: "Aarav Sharma", role, roleTitle: ROLES[role] }, cfg, deadlineDate(now(), cfg.deadlineDays).label, submitTo);
    return json({ subject: tpl.subject, html: tpl.html });
  }
  if (sub === "/test" && req.method === "POST") {
    const f = await getAssignmentFile(store, role);
    if (!f) return json({ error: "Upload the PDF first." }, 400);
    const tpl = assignmentEmail({ fullName: "Tech Team", role, roleTitle: ROLES[role] }, cfg, deadlineDate(now(), cfg.deadlineDays).label, submitTo);
    const res = await sendMail(env, submitTo, {
      subject: `[TEST] ${tpl.subject}`, html: tpl.html,
      attachments: [{ name: f.metadata?.fileName || "Assignment.pdf", content: Buffer.from(f.data).toString("base64") }],
    });
    if (!res.sent) return json({ error: res.skipped || res.error }, 502);
    return json({ ok: true, to: submitTo, messageId: res.messageId });
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
