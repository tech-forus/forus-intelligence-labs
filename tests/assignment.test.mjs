import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, processQueue } from "../lib/careers/handlers.mjs";
import { hashPassword } from "../lib/careers/auth.mjs";
import { deadlineDate, assignmentEmail, DEFAULTS } from "../lib/careers/assignment.mjs";

const LONG = "React Node.js Express MongoDB logistics freight ".repeat(10);

function memStore() {
  const m = new Map();
  return {
    m,
    async set(k, v, o = {}) { m.set(k, { data: v, metadata: o.metadata || {} }); },
    async setJSON(k, v) { m.set(k, { data: JSON.stringify(v), metadata: {} }); },
    async get(k, o = {}) { const e = m.get(k); if (!e) return null; return o.type === "json" ? JSON.parse(e.data) : e.data; },
    async getWithMetadata(k) { const e = m.get(k); return e ? { data: e.data, metadata: e.metadata } : null; },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
  };
}
const RESUME = new TextEncoder().encode("%PDF-1.4\n%resume\n");
const TASK = new TextEncoder().encode("%PDF-1.7\n%the assignment\n");
function applyReq(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) fd.append(k, x);
  fd.append("resume", new Blob([RESUME]), "cv.pdf");
  return new Request("https://x/api/careers/apply", { method: "POST", body: fd });
}
const person = (email, extra) => ({
  fullName: "Asha Rao", email, phone: "+91 98765 43210", consent: "yes", resumeText: LONG,
  branch: "CSE", experienceYears: "1", skills: ["React", "Node.js", "Express", "MongoDB"],
  built: "Built a freight tracker on MERN for transporters, deployed with JWT auth and role-based access.",
  github: "github.com/asha", ...extra,
});
const good = (email) => person(email, { role: "software", class10: "93", class12: "90", cgpa: "8.6" });
const low = (email) => person(email, { role: "software", class10: "70", class12: "72", cgpa: "6.5" });
const hw = (email) => person(email, { role: "hardware", branch: "ECE", class10: "93", class12: "90", cgpa: "8.6", skills: ["PCB design", "Embedded C"] });

const ENV = { CAREERS_BREVO_KEY: "k", CAREERS_FROM_EMAIL: "careers@forusintelligencelabs.com", CAREERS_REPLY_TO: "tech@foruselectric.com" };
async function withBrevo(fn) {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messageId: "m" + sent.length }), { status: 201 }); };
  try { await fn(); } finally { globalThis.fetch = real; }
  return sent;
}
async function adminToken(ctx) {
  process.env.ADMIN_PASSWORD_HASH = hashPassword("pw-for-tests-only");
  const { token } = await (await handle(new Request("https://x/api/careers/admin/login", { method: "POST", body: JSON.stringify({ username: "tech", password: "pw-for-tests-only" }) }), ctx)).json();
  delete process.env.ADMIN_PASSWORD_HASH;
  return { authorization: `Bearer ${token}` };
}
let ipN = 0;
const ctxFor = (store) => ({ store, ip: "10.1.0." + (++ipN), env: ENV });

test("deadline is counted from the send date, in India time", () => {
  const from = Date.parse("2026-11-12T20:00:00Z"); // 13 Nov 01:30 IST
  assert.equal(deadlineDate(from, 12).label, "25 November 2026");
  const e = assignmentEmail({ fullName: "Asha Rao", role: "software", roleTitle: "Software Developer" }, DEFAULTS.software, "25 November 2026", "tech@foruselectric.com");
  assert.match(e.subject, /Software Developer/);
  assert.match(e.html, /Hi Asha/);
  assert.match(e.html, /MVP Voice Agent/);
  assert.match(e.html, /Deadline: 25 November 2026/);
  assert.doesNotMatch(e.html, /Forus Electric|15-11-2026|Fresher/);
});

test("nothing is queued while the assignment is off or has no PDF", async () => {
  const store = memStore();
  const { id } = await (await handle(applyReq(good("a@x.com")), ctxFor(store))).json();
  assert.equal((await store.get(`app/${id}`, { type: "json" })).pending, undefined);
  assert.equal((await store.list({ prefix: "mailq/" })).blobs.length, 0);
});

test("admin sets it up; qualifying software applicants get the PDF once, others do not", async () => {
  const store = memStore();
  const ctx = ctxFor(store);
  const H = await adminToken(ctx);
  const A = (p, o = {}) => handle(new Request("https://x/api/careers/admin" + p, { ...o, headers: { ...H, ...(o.headers || {}) } }), ctx);

  // an application from before the feature: must never be auto-sent
  const before = await (await handle(applyReq(good("old@x.com")), ctxFor(store))).json();

  // upload + enable
  assert.equal((await A("/assignments/software/file", { method: "PUT", body: new TextEncoder().encode("not a pdf") })).status, 400);
  const up = await (await A("/assignments/software/file", { method: "PUT", body: TASK, headers: { "x-file-name": encodeURIComponent("Technical Assignment.pdf") } })).json();
  assert.equal(up.file.fileName, "Technical Assignment.pdf");
  const put = await (await A("/assignments/software", { method: "PUT", body: JSON.stringify({ enabled: true, deadlineDays: 12 }) })).json();
  assert.equal(put.settings.enabled, true);
  const list = await (await A("/assignments")).json();
  assert.equal(list.roles.software.file.fileName, "Technical Assignment.pdf");
  assert.equal(list.roles.hardware.file, null);
  assert.match((await (await A("/assignments/software/preview")).json()).html, /Aarav/);

  const g = await (await handle(applyReq(good("good@x.com")), ctxFor(store))).json();
  const l = await (await handle(applyReq(low("low@x.com")), ctxFor(store))).json();
  const h = await (await handle(applyReq(hw("hw@x.com")), ctxFor(store))).json();
  const app = (id) => store.get(`app/${id}`, { type: "json" });
  assert.equal((await app(g.id)).pending.kind, "assignment");
  assert.equal((await app(l.id)).pending.kind, "regret");
  assert.equal((await app(h.id)).pending, undefined, "hardware has no assignment yet");
  assert.equal((await app(before.id)).pending, undefined, "no backfill");

  const sent = await withBrevo(() => processQueue(store, ENV));
  assert.equal(sent.length, 1, "only the due assignment; the regret waits 24 h");
  assert.deepEqual(sent[0].to, [{ email: "good@x.com" }]);
  assert.equal(sent[0].attachment[0].name, "Technical Assignment.pdf");
  assert.equal(Buffer.from(sent[0].attachment[0].content, "base64").toString(), "%PDF-1.7\n%the assignment\n");
  assert.match(sent[0].htmlContent, /Deadline: \d{1,2} \w+ 20\d\d/);
  const ga = await app(g.id);
  assert.equal(ga.assignment.status, "sent");
  assert.equal(ga.status, "assignment-sent");
  assert.equal(ga.pending, null);
  assert.equal(ga.email, "good@x.com");

  // never twice: manual send refuses, a stray queue item is dropped
  assert.equal((await A(`/applications/${g.id}/send-assignment`, { method: "POST" })).status, 409);
  await store.setJSON(`mailq/${g.id}`, { id: g.id, kind: "assignment", dueAt: new Date().toISOString(), tries: 0 });
  assert.equal((await withBrevo(() => processQueue(store, ENV))).length, 0);

  // manual send to the older application works
  let r;
  const s2 = await withBrevo(async () => { r = await (await A(`/applications/${before.id}/send-assignment`, { method: "POST" })).json(); });
  assert.equal(s2.length, 1);
  assert.equal(r.application.assignment.status, "sent");
  assert.equal(r.application.assignment.manual, true);

  // test email goes to the team address with the PDF
  const s3 = await withBrevo(async () => { r = await (await A("/assignments/software/test", { method: "POST" })).json(); });
  assert.equal(r.to, "tech@foruselectric.com");
  assert.match(s3[0].subject, /^\[TEST\]/);
  assert.equal(s3[0].attachment.length, 1);
});

test("turning auto-send off before the run cancels queued sends", async () => {
  const store = memStore();
  const ctx = ctxFor(store);
  const H = await adminToken(ctx);
  const A = (p, o = {}) => handle(new Request("https://x/api/careers/admin" + p, { ...o, headers: { ...H, ...(o.headers || {}) } }), ctx);
  await A("/assignments/software/file", { method: "PUT", body: TASK });
  await A("/assignments/software", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  const g = await (await handle(applyReq(good("g2@x.com")), ctxFor(store))).json();
  await A("/assignments/software", { method: "PUT", body: JSON.stringify({ enabled: false }) });
  const sent = await withBrevo(() => processQueue(store, ENV));
  assert.equal(sent.length, 0);
  const a = await store.get(`app/${g.id}`, { type: "json" });
  assert.equal(a.assignment.status, "not sent");
  assert.equal(a.pending, null);
});
