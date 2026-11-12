// Resume file checks and text extraction.
// The browser-supplied MIME type is ignored; the file's own first bytes decide.

export const MAX_RESUME_BYTES = 4 * 1024 * 1024; // Netlify sync functions cap a request at ~6 MB

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

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("extract timeout")), ms))]);

const MAX_TEXT = 40_000;
const tidy = (s) => s.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

/**
 * Best-effort plain text from a resume. Never throws: an unreadable file just
 * yields '' and the application is still saved (it scores on form answers).
 */
export async function extractText(bytes, kind) {
  try {
    if (kind === "pdf") {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await withTimeout(getDocumentProxy(new Uint8Array(bytes)), 8000);
      const { text } = await withTimeout(pdfText(pdf, { mergePages: true }), 8000);
      return tidy(Array.isArray(text) ? text.join(" ") : text || "");
    }
    if (kind === "docx") {
      const { default: JSZip } = await import("jszip");
      const zip = await withTimeout(JSZip.loadAsync(bytes), 6000);
      const xml = await zip.file("word/document.xml")?.async("string");
      if (!xml) return "";
      return tidy(
        xml
          .replace(/<\/w:p>/g, "\n")
          .replace(/<w:tab\/>/g, " ")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      );
    }
    if (kind === "doc") {
      // Legacy Word: no parser; pull runs of printable text, which catches most words.
      const s = Buffer.from(bytes).toString("latin1");
      return tidy((s.match(/[\x20-\x7e]{4,}/g) || []).join(" "));
    }
  } catch (e) {
    console.warn("[careers] resume text extraction failed:", e?.message);
  }
  return "";
}
