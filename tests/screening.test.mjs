import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, academics, toPercent, toCgpa, ACADEMIC_BAR } from "../lib/careers/policy.mjs";
import { scoreApplication } from "../lib/careers/scoring.mjs";
import { handle, processQueue } from "../lib/careers/handlers.mjs";
import { hashPassword } from "../lib/careers/auth.mjs";
import { parseResume } from "../public/assets/resume-parse.js";

const LONG = "x ".repeat(150); // readable-length resume text

const swStrong = { role: "software", branch: "CSE", experienceYears: 2, skills: ["React", "Node.js", "Express", "MongoDB"], domains: ["Logistics / freight"], built: "Built a freight tracker on MERN for transporters, deployed on Render with JWT auth and role-based access.", links: { github: "g" } };
const swNone = { role: "software", branch: "CSE", experienceYears: 0, skills: [], domains: [], built: "I am a hard working person.", links: {} };
const marks = (c10, c12, cg) => ({ class10: c10, class12: c12, cgpa: cg });

function run(base, m, text = LONG) {
  const a = { ...base, ...m };
  return decide(a, scoreApplication(a, text), text.length);
}

test("mark normalisation", () => {
  assert.equal(toPercent(9.2), 87.4);   // CBSE CGPA x 9.5
  assert.equal(toPercent(91), 91);
  assert.equal(toCgpa(8.27), 8.27);
  assert.equal(toCgpa(76), 8);          // % / 9.5
  assert.equal(toPercent(null), null);
  assert.deepEqual(ACADEMIC_BAR, { class10: 85, class12: 85, cgpa: 8 });
});

test("academic bar: missing marks count as not met", () => {
  assert.equal(academics(marks(90, null, 8.5)).met, 2);  // diploma, no 12th: still passes
  assert.equal(academics(marks(90, null, 8.5)).passes, true);
  assert.equal(academics(marks(85, 85, 8.0)).met, 3);    // exactly on the bar passes
  assert.equal(academics(marks(84.9, 85, 7.99)).met, 1);
});

test("decision table", () => {
  // 3/3 and 2/3 keep, skills or not
  assert.equal(run(swStrong, marks(92, 91, 8.3)).action, "keep");
  assert.equal(run(swStrong, marks(92, 70, 8.3)).action, "keep");
  assert.equal(run(swNone, marks(92, 91, 8.3)).action, "keep");
  assert.ok(run(swNone, marks(92, 91, 8.3)).flags.includes("weak-skills"));
  // 1/3 or 0/3 with real skills: kept on file + regret email
  assert.equal(run(swStrong, marks(92, 70, 6.5)).action, "regret");
  assert.equal(run(swStrong, marks(60, 60, 6)).action, "regret");
  // 1/3 or 0/3 with no relevant skills: discard
  const d = run(swNone, marks(70, 72, 6.1));
  assert.equal(d.action, "discard");
  assert.ok(d.reasons.some((r) => /10th 70% is below/.test(r)));
  assert.ok(d.reasons.some((r) => /core MERN/.test(r)));
  assert.ok(d.reasons.some((r) => /GitHub or portfolio/.test(r)));
  // never discard what we could not read
  assert.equal(run(swNone, marks(70, 72, 6.1), "").action, "regret");
});

test("parser reads the fields that matter", () => {
  const text = [
    "RAHUL VERMA",
    "rahul.verma@example.com | +91-9876543210 | linkedin.com/in/rahulv | github.com/rahulv | Pune",
    "EDUCATION",
    "National Institute of Technology, Trichy 2020 - 2024",
    "B.Tech in Computer Science and Engineering | CGPA: 8. 6",
    "Delhi Public School 2019 - 2020",
    "Class XII (CBSE) | 89.4%",
    "Class X (CBSE) | 93%",
    "EXPERIENCE",
    "Shiprocket - Software Engineer Jan 2024 - Present",
    "Built order tracking with React, Node.js, Express and MongoDB; Redis caching; logistics dashboards.",
  ].join("\n");
  const p = parseResume(text);
  assert.equal(p.fullName, "Rahul Verma");
  assert.equal(p.email, "rahul.verma@example.com");
  assert.equal(p.phone, "+91 98765 43210");
  assert.equal(p.branch, "CSE");
  assert.equal(p.degree, "B.Tech / B.E.");
  assert.equal(p.gradYear, 2024);
  assert.equal(p.cgpa, 8.6);
  assert.equal(p.class12, 89.4);
  assert.equal(p.class10, 93);
  assert.equal(p.city, "Pune");
  assert.match(p.github, /github\.com\/rahulv/);
  assert.ok(["React", "Node.js", "Express", "MongoDB", "Redis"].every((s) => p.skills.includes(s)));
  assert.ok(p.domains.includes("Logistics / freight"));
  assert.ok(p.experienceYears >= 2);
});

// ---- queue: regret email waits for config, discard moves to rejections, cancel works
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
const PDF = new TextEncoder().encode("%PDF-1.4\n%fake but sniffable\n");
function applyReq(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) fd.append(k, x);
  fd.append("resume", new Blob([PDF]), "cv.pdf");
  return new Request("https://x/api/careers/apply", { method: "POST", body: fd });
}
const base = {
  fullName: "Test Person", email: "t@example.com", phone: "+91 98765 43210", consent: "yes",
  resumeText: LONG,
};

test("queue: regret waits for email config, then sends; discard moves to rejections", async () => {
  const store = memStore();
  const ip = (n) => ({ store, ip: "10.0.0." + n, env: {} });

  const strongLow = await (await handle(applyReq({ ...base, role: "software", branch: "CSE", experienceYears: "2", skills: ["React", "Node.js", "Express", "MongoDB"], built: "Built a freight tracker on MERN for transporters, deployed with JWT auth.", github: "g.com/x", class10: "70", class12: "72", cgpa: "6.5" }), ip(1))).json();
  const junk = await (await handle(applyReq({ ...base, role: "software", branch: "CSE", built: "I am a very hard working and honest person.", class10: "65", class12: "60", cgpa: "5.9" }), ip(2))).json();
  const good = await (await handle(applyReq({ ...base, role: "software", branch: "CSE", skills: ["React"], built: "Built a todo app with React and deployed it on Vercel for my college club.", class10: "95", class12: "93", cgpa: "9.1" }), ip(3))).json();

  const app = async (id) => store.get(`app/${id}`, { type: "json" });
  assert.equal((await app(strongLow.id)).screening.action, "regret");
  assert.equal((await app(strongLow.id)).status, "below-bar");
  assert.equal((await app(junk.id)).screening.action, "discard");
  assert.equal((await app(good.id)).screening.action, "keep");
  assert.equal((await app(good.id)).pending, undefined);

  // not due yet: nothing happens
  let r = await processQueue(store, {});
  assert.equal(r.discarded + r.sent + r.waiting, 0);

  // due, but no email config: discard still happens, emails wait
  r = await processQueue(store, {}, { force: true });
  assert.equal(r.discarded, 1);
  assert.equal(await app(junk.id), null);
  assert.equal(await store.get(`resume/${junk.id}`), null);
  const rej = await store.get(`rejection/${junk.id}`, { type: "json" });
  assert.equal(rej.email, "t@example.com");
  assert.ok(rej.reasons.length >= 3);
  assert.equal(r.waiting, 2);
  assert.equal((await app(strongLow.id)).mail.status, "waiting");
  assert.ok(await store.get(`resume/${strongLow.id}`)); // regret keeps the resume

  // with config: Brevo is called for both, queue empties
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messageId: "m1" }), { status: 201 }); };
  try {
    r = await processQueue(store, { CAREERS_BREVO_KEY: "k", CAREERS_FROM_EMAIL: "careers@forusintelligencelabs.com" }, { force: true });
  } finally { globalThis.fetch = realFetch; }
  assert.equal(r.sent, 2);
  assert.equal(sent.length, 2);
  assert.ok(sent.some((b) => /no need to apply again/i.test(b.htmlContent)));
  assert.ok(sent.every((b) => b.replyTo.email === "tech@foruselectric.com"));
  assert.equal((await app(strongLow.id)).mail.status, "sent");
  assert.equal((await app(strongLow.id)).email, "t@example.com");
  assert.equal((await app(strongLow.id)).pending, null);
  assert.equal((await store.list({ prefix: "mailq/" })).blobs.length, 0);
});

test("admin can cancel a pending action and see rejections", async () => {
  const store = memStore();
  const ctx = { store, ip: "1.1.1.1", env: {} };
  const { id } = await (await handle(applyReq({ ...base, role: "software", branch: "CSE", built: "I am a very hard working and honest person.", class10: "65", class12: "60", cgpa: "5.9" }), ctx)).json();

  process.env.ADMIN_PASSWORD_HASH = hashPassword("pw-for-tests-only");
  const { token } = await (await handle(new Request("https://x/api/careers/admin/login", { method: "POST", body: JSON.stringify({ username: "tech", password: "pw-for-tests-only" }) }), ctx)).json();
  delete process.env.ADMIN_PASSWORD_HASH;
  const H = { authorization: `Bearer ${token}` };

  const c = await (await handle(new Request(`https://x/api/careers/admin/applications/${id}/cancel-action`, { method: "POST", headers: H }), ctx)).json();
  assert.equal(c.application.pending, null);
  assert.equal(c.application.status, "new");
  const r = await processQueue(store, {}, { force: true });
  assert.equal(r.discarded, 0); // cancelled: nothing discarded
  assert.ok(await store.get(`app/${id}`, { type: "json" }));

  const list = await (await handle(new Request("https://x/api/careers/admin/rejections", { headers: H }), ctx)).json();
  assert.deepEqual(list.rejections, []);
});
