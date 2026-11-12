// Screening policy: the academic bar, the skills bar, and what happens to each application.
// Change the numbers here; everything else (form, admin, emails) reads from this file.

export const ACADEMIC_BAR = {
  class10: 85, // % (boss's 90, minus 5 points of wiggle room)
  class12: 85, // %
  cgpa: 8.0,   // on a 10-point scale
};

// Discard only when the skills bar ALSO fails. Below this role-track score, with no
// core skill for the role, the application has nothing we can use.
export const SKILL_FLOOR = 20;

// Unreadable resumes are never discarded automatically: we cannot judge what we could not read.
export const MIN_READABLE_CHARS = 200;

// Emails and discards wait this long (hours) so the admin can cancel a wrong call.
export const ACTION_DELAY_HOURS = 24;

// The careers mailer shares nothing with FreightCompare, but still caps itself.
export const MAIL_CAP_PER_RUN = 10;
export const MAIL_CAP_PER_DAY = 40;

/** Percent from a mark that may be given as a CGPA (<= 10, CBSE-style x 9.5) or a percentage. */
export function toPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 10) return Math.round(n * 9.5 * 10) / 10;
  return n <= 100 ? n : null;
}

/** CGPA on a 10-point scale from a CGPA (<= 10) or a percentage (/ 9.5). */
export function toCgpa(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 10) return Math.round(n * 100) / 100;
  return n <= 100 ? Math.round((n / 9.5) * 100) / 100 : null;
}

/** How many of the three academic marks clear the bar. Missing marks count as not met. */
export function academics(a) {
  const p10 = toPercent(a.class10);
  const p12 = toPercent(a.class12);
  const cg = toCgpa(a.cgpa);
  const checks = [
    { key: "class10", label: "10th", value: p10, unit: "%", min: ACADEMIC_BAR.class10, met: p10 !== null && p10 >= ACADEMIC_BAR.class10 },
    { key: "class12", label: "12th", value: p12, unit: "%", min: ACADEMIC_BAR.class12, met: p12 !== null && p12 >= ACADEMIC_BAR.class12 },
    { key: "cgpa", label: "CGPA", value: cg, unit: "", min: ACADEMIC_BAR.cgpa, met: cg !== null && cg >= ACADEMIC_BAR.cgpa },
  ];
  const met = checks.filter((c) => c.met).length;
  return { met, of: 3, passes: met >= 2, checks };
}

const CORE_SOFTWARE = ["MongoDB", "Express", "React", "Node.js"];

/**
 * Decide what happens to an application.
 *   keep     meets the academic bar (2 or 3 of 3)
 *   regret   1 or 0 of 3: kept and rated in /admin, sent the "on file" email
 *   discard  fails academics AND skills: resume deleted, reasons kept under Rejections,
 *            sent a polite closing email
 * @returns {{action:'keep'|'regret'|'discard', academics:object, skillsOk:boolean, reasons:string[], flags:string[]}}
 */
export function decide(a, scores, resumeTextLength) {
  const acad = academics(a);
  const track = a.role === "hardware" ? scores.hardware : scores[scores.best] || scores.freightcompare;
  const signals = track?.signals || [];
  const coreHits = a.role === "hardware"
    ? signals.filter((s) => !["Built a prototype", "Robotics", "Competitions", "Shipped / sold", "Patent / paper", "Open hardware"].includes(s)).length
    : signals.filter((s) => CORE_SOFTWARE.includes(s)).length;
  const skillsOk = (track?.score || 0) >= SKILL_FLOOR && coreHits > 0;
  const readable = resumeTextLength >= MIN_READABLE_CHARS;

  const reasons = [];
  for (const c of acad.checks) {
    if (c.value === null) reasons.push(`${c.label} marks not given`);
    else if (!c.met) reasons.push(`${c.label} ${c.value}${c.unit} is below the ${c.min}${c.unit} bar`);
  }
  if (!skillsOk) {
    reasons.push(a.role === "hardware"
      ? "No hands-on electronics skills found (PCB, embedded, power, CAD/fabrication)"
      : "None of the core MERN skills found (MongoDB, Express, React, Node.js)");
    if ((track?.score || 0) < SKILL_FLOOR) reasons.push(`Fit score ${track?.score || 0}/100 for the role`);
  }
  if (!scores.eligibleBranch) reasons.push(`Branch ${a.branch} is outside the criteria for this role`);
  if (!a.links?.github && !a.links?.portfolio) reasons.push("No GitHub or portfolio link to show work");
  if ((a.built || "").trim().length < 80) reasons.push("'What you have built' answer is very short");
  if (!readable) reasons.push("Resume text could not be read (scanned image or unusual file)");

  const flags = [];
  if (!readable) flags.push("unreadable-resume");
  if (!skillsOk) flags.push("weak-skills");

  let action = "keep";
  if (!acad.passes) action = skillsOk || !readable ? "regret" : "discard";
  return { action, academics: acad, skillsOk, reasons, flags };
}
