// Take-home assignments: one PDF + email settings per role, sent automatically to
// applicants who meet the bar, or by hand from /admin.
//
// Store layout (same store as handlers.mjs):
//   assignment/<role>       settings JSON (see DEFAULTS)
//   assignment-file/<role>  the PDF bytes, metadata { fileName, size, uploadedAt }
//
// Nothing here is in the public repo's static files: the PDF lives only in the store.

import { ROLES } from "./validate.mjs";
import { esc, firstName, shell } from "./mailer.mjs";

export const MAX_ASSIGNMENT_BYTES = 5 * 1024 * 1024;

const COMMON = {
  enabled: false,
  deadlineDays: 12,
  title: "",
  about: "The attached PDF explains the task, what we expect and how it will be reviewed.",
  submit: [
    "A GitHub repository link with your work and a README (setup steps and how to run it)",
    "A short demo video (2–3 minutes)",
    "A brief note on your design choices and anything you could not complete",
  ],
  note: "",
};

export const DEFAULTS = {
  software: {
    ...COMMON,
    title: "building an MVP Voice Agent",
    about: "The attached PDF explains the complete flow, system architecture, API/WebSocket events, error handling, acceptance criteria and deliverables.",
    submit: [
      "A GitHub repository link with your code and a README (setup steps and how to run it)",
      "A short demo video (2–3 minutes) of a working conversation",
      "A brief note on your design choices and anything you could not complete",
    ],
    note: "You can complete this at no cost: most speech and AI providers offer free trial credits, and open-source tools are also fine. Please do not use any paid plans for this assignment.",
  },
  hardware: { ...COMMON },
};

export const assignmentRoles = () => Object.keys(DEFAULTS);

/** Settings for a role, merged over the defaults. */
export async function getAssignment(store, role) {
  if (!DEFAULTS[role]) return null;
  const saved = (await store.get(`assignment/${role}`, { type: "json" })) || {};
  return { ...DEFAULTS[role], ...saved, role };
}

/** Validate and save settings coming from /admin. Returns { settings } or { error }. */
export async function saveAssignment(store, role, body) {
  if (!DEFAULTS[role]) return { error: "Unknown role" };
  const cur = await getAssignment(store, role);
  const s = (v, max) => String(v ?? "").trim().slice(0, max);
  const next = { ...cur };
  if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
  if (body.deadlineDays !== undefined) {
    const d = Math.round(Number(body.deadlineDays));
    if (!Number.isFinite(d) || d < 1 || d > 60) return { error: "Deadline must be 1 to 60 days." };
    next.deadlineDays = d;
  }
  if (body.title !== undefined) next.title = s(body.title, 200);
  if (body.about !== undefined) next.about = s(body.about, 1000);
  if (body.note !== undefined) next.note = s(body.note, 1000);
  if (body.submit !== undefined) {
    const lines = Array.isArray(body.submit) ? body.submit : String(body.submit).split(/\r?\n/);
    next.submit = lines.map((l) => s(l, 300)).filter(Boolean).slice(0, 10);
  }
  next.updatedAt = new Date().toISOString();
  const { role: _r, ...toStore } = next;
  await store.setJSON(`assignment/${role}`, toStore);
  return { settings: next };
}

export async function getAssignmentFile(store, role) {
  return store.getWithMetadata(`assignment-file/${role}`, { type: "arrayBuffer" });
}

/** Who gets the assignment automatically: met the academic bar for a role that has one. */
export function qualifiesForAssignment(app) {
  return Boolean(app && DEFAULTS[app.role] && app.screening?.action === "keep");
}

/** "26 November 2026", in India time. */
export function deadlineDate(fromMs, days) {
  const d = new Date(fromMs + days * 24 * 60 * 60 * 1000);
  return {
    iso: d.toISOString(),
    label: d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" }),
  };
}

export function assignmentEmail(app, cfg, deadlineLabel, submitTo) {
  const n = esc(firstName(app.fullName));
  const roleTitle = app.roleTitle || ROLES[app.role] || "the open role";
  const what = cfg.title ? `: ${esc(cfg.title)}` : "";
  const li = (x) => `<li style="margin:0 0 4px">${esc(x)}</li>`;
  return {
    subject: `Next step for your ${roleTitle} application: technical assignment`,
    html: shell(`<p>Hi ${n},</p>
<p>Thank you for applying for the <b>${esc(roleTitle)}</b> role at Forus Intelligence Labs. We were glad to receive your application.</p>
<p>As the next step in our selection process, we would like you to complete a technical assignment${what}. ${esc(cfg.about)}</p>
<p style="margin-bottom:4px"><b>What we are looking for</b></p>
<ul style="margin-top:0;padding-left:20px">${li("Your problem-solving and analytical approach")}${li("Clean, well-structured work")}${li("Your ability to learn new tools and apply them to a real-world project")}</ul>
${cfg.submit?.length ? `<p style="margin-bottom:4px"><b>What to submit</b></p><ul style="margin-top:0;padding-left:20px">${cfg.submit.map(li).join("")}</ul>` : ""}
<p><b>Deadline: ${esc(deadlineLabel)}</b></p>
${cfg.note ? `<p>${esc(cfg.note)}</p>` : ""}
<p>Please send your submission to <a href="mailto:${esc(submitTo)}" style="color:#3b6fe0">${esc(submitTo)}</a> (replying to this email works too). If anything in the task is unclear, reply and we will be happy to help.</p>
<p>All the best!</p>
<p>Regards,<br>Tech Team<br>Forus Intelligence Labs<br>Okhla, New Delhi</p>`),
  };
}
