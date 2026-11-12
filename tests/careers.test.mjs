import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../lib/careers/handlers.mjs";
import { scoreApplication, matchGroups } from "../lib/careers/scoring.mjs";
import { sniffResume, tidyText } from "../lib/careers/files.mjs";
import { hashPassword, verifyPassword } from "../lib/careers/auth.mjs";

// ---- in-memory stand-in for a Netlify Blobs store
function memStore() {
  const m = new Map();
  return {
    m,
    async set(k, v, o = {}) { m.set(k, { data: v, metadata: o.metadata || {} }); },
    async setJSON(k, v) { m.set(k, { data: JSON.stringify(v), metadata: {} }); },
    async get(k, o = {}) {
      const e = m.get(k); if (!e) return null;
      return o.type === "json" ? JSON.parse(e.data) : e.data;
    },
    async getWithMetadata(k) { const e = m.get(k); return e ? { data: e.data, metadata: e.metadata } : null; },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
  };
}

// A tiny but valid one-page PDF containing the given text.
function makePdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offs.forEach((o) => { out += `${String(o).padStart(10, "0")} 00000 n \n`; });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

const base = "https://forusintelligencelabs.com";
function form(fields, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const x of [].concat(v)) fd.append(k, x);
  }
  if (file) fd.append("resume", new Blob([file.bytes]), file.name);
  return new Request(`${base}/api/careers/apply`, { method: "POST", body: fd });
}
const good = {
  role: "software", fullName: "Test Person", email: "t@example.com", phone: "+91 98765 43210",
  branch: "CSE", experienceYears: "3", skills: ["React", "Node.js", "MongoDB", "Express"],
  domains: ["Logistics / freight"], built: "Built a freight rate comparison tool for transporters in Delhi.",
  consent: "yes", github: "github.com/test",
  resumeText: "MERN developer, logistics and freight TMS",
  class10: "92", class12: "88", cgpa: "8.4",
};

test("sniffs resume types from bytes, not names", () => {
  assert.equal(sniffResume(makePdf("hi")), "pdf");
  assert.equal(sniffResume(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0])), "docx");
  assert.equal(sniffResume(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])), "doc");
  assert.equal(sniffResume(new TextEncoder().encode("<html>not a resume</html>")), null);
});

test("resume text from the browser is tidied and capped", () => {
  assert.equal(tidyText("  KiCad\n\n PCB  "), "KiCad PCB");
  assert.equal(tidyText(undefined), "");
  assert.equal(tidyText("x".repeat(50000)).length, 40000);
});

test("keyword matching respects word edges", () => {
  assert.deepEqual(matchGroups("worked with node.js and react", [["Node", "node.js"], ["React", "react"]]), ["Node", "React"]);
  assert.deepEqual(matchGroups("mysql only", [["SQL", "sql"]]), []);
  assert.deepEqual(matchGroups("evaluation", [["EV", "ev"]]), []);
});

test("MERN + logistics ranks highest for FreightCompare", () => {
  const fcDev = scoreApplication({ ...good, skills: good.skills, experienceYears: 3, links: { github: "x" } }, "TMS and fleet dispatch, supply chain");
  const plainDev = scoreApplication({ ...good, domains: [], built: "a todo app", experienceYears: 3, links: { github: "x" } }, "");
  const erpDev = scoreApplication({ ...good, domains: [], built: "inventory, GST invoicing and ledger", experienceYears: 3, links: {} }, "");
  assert.ok(fcDev.freightcompare.score > plainDev.freightcompare.score + 20);
  assert.ok(fcDev.freightcompare.score >= 85, `fc ${fcDev.freightcompare.score}`);
  assert.ok(erpDev.forusbiz.score > erpDev.freightcompare.score);
  assert.equal(erpDev.best, "forusbiz");
  assert.ok(fcDev.tags.includes("MERN") && fcDev.tags.includes("Logistics"));
});

test("hardware makers score on real build evidence", () => {
  const maker = scoreApplication({
    role: "hardware", branch: "ECE", experienceYears: 2, skills: ["PCB design (KiCad/Altium)", "STM32 / ESP32"],
    built: "Designed and built a 48V BMS on STM32 with a custom KiCad PCB, prototyped, tested on an oscilloscope, took it to SAE Baja.",
    links: { portfolio: "https://x" },
  }, "power electronics, buck converter, soldering, 3d printing");
  const lister = scoreApplication({ role: "hardware", branch: "CSE", experienceYears: 0, skills: ["Arduino"], built: "Interested in electronics.", links: {} }, "");
  assert.ok(maker.hardware.score >= 85, `maker ${maker.hardware.score}`);
  assert.ok(lister.hardware.score < 30, `lister ${lister.hardware.score}`);
  assert.equal(maker.eligibleBranch, true);
  assert.equal(lister.eligibleBranch, false);
});

test("password hashing round-trips and rejects wrong passwords", () => {
  const h = hashPassword("correct horse");
  assert.equal(verifyPassword("correct horse", h), true);
  assert.equal(verifyPassword("wrong", h), false);
  assert.equal(verifyPassword("", h), false);
});

test("apply -> admin login -> list -> resume -> update -> delete", async () => {
  const store = memStore();
  const ctx = { store, ip: "1.2.3.4" };
  const pdf = makePdf("MERN developer, logistics and freight TMS");

  const bad = await handle(form({ ...good, consent: "" }, { bytes: pdf, name: "cv.pdf" }), ctx);
  assert.equal(bad.status, 400);
  const notPdf = await handle(form(good, { bytes: new TextEncoder().encode("<script>x</script>!!"), name: "cv.pdf" }), ctx);
  assert.equal(notPdf.status, 400);

  const ok = await handle(form(good, { bytes: pdf, name: "my cv.pdf" }), ctx);
  assert.equal(ok.status, 200);
  const { id } = await ok.json();

  // admin endpoints refuse without a session
  assert.equal((await handle(new Request(`${base}/api/careers/admin/applications`), ctx)).status, 401);
  assert.equal((await handle(new Request(`${base}/api/careers/admin/applications/${id}/resume`), ctx)).status, 401);

  const h = hashPassword("test-pass");
  process.env.ADMIN_PASSWORD_HASH = h;
  const wrong = await handle(new Request(`${base}/api/careers/admin/login`, { method: "POST", body: JSON.stringify({ username: "tech", password: "nope" }) }), ctx);
  assert.equal(wrong.status, 401);
  const li = await handle(new Request(`${base}/api/careers/admin/login`, { method: "POST", body: JSON.stringify({ username: "tech", password: "test-pass" }) }), ctx);
  const { token } = await li.json();
  delete process.env.ADMIN_PASSWORD_HASH;
  const auth = { authorization: `Bearer ${token}` };

  const list = await (await handle(new Request(`${base}/api/careers/admin/applications`, { headers: auth }), ctx)).json();
  assert.equal(list.applications.length, 1);
  const a = list.applications[0];
  assert.equal(a.resumeText, undefined); // list stays light
  assert.ok(a.scores.freightcompare.score > 60);

  const one = await (await handle(new Request(`${base}/api/careers/admin/applications/${id}`, { headers: auth }), ctx)).json();
  assert.match(one.application.resumeText, /logistics and freight/);

  const r = await handle(new Request(`${base}/api/careers/admin/applications/${id}/resume`, { headers: auth }), ctx);
  assert.equal(r.headers.get("content-type"), "application/pdf");

  const up = await handle(new Request(`${base}/api/careers/admin/applications/${id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "shortlisted", notes: "call", starred: true }) }), ctx);
  assert.equal((await up.json()).application.status, "shortlisted");
  const badStatus = await handle(new Request(`${base}/api/careers/admin/applications/${id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "lol" }) }), ctx);
  assert.equal(badStatus.status, 400);

  await handle(new Request(`${base}/api/careers/admin/applications/${id}`, { method: "DELETE", headers: auth }), ctx);
  assert.equal([...store.m.keys()].filter((k) => k.startsWith("app/") || k.startsWith("resume/")).length, 0);
});

test("honeypot and rate limit", async () => {
  const store = memStore();
  const pdf = makePdf("x");
  const bot = await handle(form({ ...good, website: "spam.example" }, { bytes: pdf, name: "a.pdf" }), { store, ip: "9.9.9.9" });
  assert.equal(bot.status, 200);
  assert.equal([...store.m.keys()].filter((k) => k.startsWith("app/")).length, 0);
  let last;
  for (let i = 0; i < 6; i++) last = await handle(form(good, { bytes: pdf, name: "a.pdf" }), { store, ip: "5.5.5.5" });
  assert.equal(last.status, 429);
});
