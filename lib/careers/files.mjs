// Resume file checks.
// The browser-supplied MIME type is ignored; the file's own first bytes decide.
//
// Resume *text* is read in the applicant's browser (pdf.js / JSZip on /careers) and sent
// with the form as `resumeText`. Parsing PDFs server-side would blow the ~10 ms CPU budget
// of Cloudflare's free tier. The original file is always stored, so the admin can open it.

export const MAX_RESUME_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT = 40_000;

const TYPES = {
  pdf: { ext: "pdf", mime: "application/pdf" },
  docx: { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  doc: { ext: "doc", mime: "application/msword" },
};

/** @param {Uint8Array} b @returns {'pdf'|'docx'|'doc'|null} */
export function sniffResume(b) {
  if (!b || b.length < 8) return null;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf"; // %PDF
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "docx"; // PK zip
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "doc"; // OLE2
  return null;
}

export const typeInfo = (kind) => TYPES[kind];

/** Normalise browser-extracted resume text. */
export const tidyText = (s) =>
  (typeof s === "string" ? s : "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
