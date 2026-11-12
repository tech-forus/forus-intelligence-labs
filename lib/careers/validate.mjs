// Turns the raw multipart form into a clean application record, or a list of errors.

export const ROLES = {
  software: "Software Developer",
  hardware: "Hardware Innovator",
};
export const BRANCH_OPTIONS = ["CSE", "IT", "EEE", "ECE", "Other"];
export const STATUSES = ["new", "shortlisted", "interview", "offer", "hired", "rejected", "on-hold", "below-bar", "assignment-sent"];

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (vals, max, each = 60) =>
  [...new Set(vals.filter((v) => typeof v === "string").map((v) => v.trim().slice(0, each)).filter(Boolean))].slice(0, max);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9\s-]{8,15}$/;

function url(v) {
  const s = str(v, 300);
  if (!s) return "";
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

function mark(v) {
  const n = Number.parseFloat(str(v, 8));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

/** @param {FormData} fd */
export function normaliseApplication(fd) {
  const errors = [];
  const role = str(fd.get("role"), 20);
  const a = {
    role,
    fullName: str(fd.get("fullName"), 120),
    email: str(fd.get("email"), 160).toLowerCase(),
    phone: str(fd.get("phone"), 20),
    city: str(fd.get("city"), 80),
    degree: str(fd.get("degree"), 60),
    branch: str(fd.get("branch"), 20),
    college: str(fd.get("college"), 160),
    gradYear: Number.parseInt(str(fd.get("gradYear"), 4), 10) || null,
    experienceYears: Math.max(0, Math.min(40, Number.parseFloat(str(fd.get("experienceYears"), 5)) || 0)),
    currentRole: str(fd.get("currentRole"), 160),
    noticePeriod: str(fd.get("noticePeriod"), 40),
    skills: list(fd.getAll("skills"), 40),
    domains: list(fd.getAll("domains"), 20),
    built: str(fd.get("built"), 3000),
    // marks as typed: % or CGPA; policy.mjs normalises them
    class10: mark(fd.get("class10")),
    class12: mark(fd.get("class12")),
    cgpa: mark(fd.get("cgpa")),
    importedFromResume: fd.get("imported") === "yes",
    links: {
      github: url(fd.get("github")),
      linkedin: url(fd.get("linkedin")),
      portfolio: url(fd.get("portfolio")),
    },
  };

  if (!ROLES[role]) errors.push("Pick the opening you are applying for.");
  if (a.fullName.length < 2) errors.push("Enter your full name.");
  if (!EMAIL_RE.test(a.email)) errors.push("Enter a valid email address.");
  if (!PHONE_RE.test(a.phone)) errors.push("Enter a valid phone number.");
  if (!BRANCH_OPTIONS.includes(a.branch)) errors.push("Pick your branch.");
  if (a.built.length < 30) errors.push("Tell us about something you have built (a few lines at least).");
  if (a.class10 === null) errors.push("Enter your 10th marks (% or CGPA).");
  if (a.cgpa === null) errors.push("Enter your degree CGPA or percentage.");
  if (fd.get("consent") !== "yes") errors.push("Please agree to us storing your application.");

  return { application: a, errors };
}
