// Best-effort resume -> application fields, from plain text (with line breaks).
// Used by /careers ("Import from resume") and by the unit tests. Pure function, no DOM.
// Everything it fills is shown to the applicant to check and edit before submitting.

const CITIES = ["Delhi", "New Delhi", "Noida", "Gurugram", "Gurgaon", "Faridabad", "Ghaziabad", "Mumbai", "Navi Mumbai", "Thane", "Pune",
  "Bengaluru", "Bangalore", "Hyderabad", "Secunderabad", "Chennai", "Kolkata", "Ahmedabad", "Surat", "Vadodara", "Jaipur", "Lucknow",
  "Kanpur", "Nagpur", "Indore", "Bhopal", "Chandigarh", "Mohali", "Dehradun", "Coimbatore", "Kochi", "Thiruvananthapuram", "Vellore",
  "Visakhapatnam", "Vijayawada", "Bhubaneswar", "Patna", "Ranchi", "Guwahati", "Ludhiana", "Amritsar", "Mysuru", "Mysore", "Mangaluru",
  "Madurai", "Tiruchirappalli", "Nashik", "Aurangabad", "Raipur", "Jodhpur", "Udaipur", "Agra", "Varanasi", "Prayagraj", "Meerut"];

// Checkbox labels on the form -> words that count as evidence for them.
export const SKILL_HINTS = {
  "React": ["react", "react.js", "reactjs"], "Node.js": ["node.js", "nodejs", "node js"], "Express": ["express", "express.js", "expressjs"],
  "MongoDB": ["mongodb", "mongoose", "mongo"], "TypeScript": ["typescript"], "Next.js": ["next.js", "nextjs"],
  "REST APIs": ["rest api", "rest apis", "restful"], "SQL / Postgres": ["sql", "postgres", "postgresql", "mysql"], "Redis": ["redis"],
  "Docker": ["docker"], "AWS / cloud": ["aws", "gcp", "azure", "vercel", "render", "railway"],
  "React Native / Android": ["react native", "android", "kotlin", "flutter"], "LLM / AI integrations": ["llm", "openai", "langchain", "gpt", "rag"],
  "Testing (Jest / Playwright)": ["jest", "vitest", "playwright", "cypress", "mocha"],
  "PCB design (KiCad / Altium)": ["pcb", "kicad", "altium", "eagle", "easyeda", "orcad"], "Embedded C / C++": ["embedded", "firmware", "embedded c"],
  "STM32 / ESP32": ["stm32", "esp32", "esp8266"], "Arduino": ["arduino"], "Power electronics": ["power electronics", "inverter", "smps", "buck", "boost", "pwm"],
  "BMS / battery packs": ["bms", "battery management", "battery pack", "li-ion", "lithium"], "Motor control (BLDC / FOC)": ["bldc", "foc", "motor control", "servo", "stepper"],
  "CAN / I2C / SPI / UART": ["can bus", "i2c", "spi", "uart", "modbus"], "FPGA / Verilog": ["fpga", "verilog", "vhdl"],
  "LTspice / Simulink": ["ltspice", "simulink", "matlab", "multisim", "plecs", "pspice"],
  "Mechanical CAD (SolidWorks / Fusion 360)": ["solidworks", "fusion 360", "fusion360", "autocad", "catia", "creo"],
  "3D printing / CNC": ["3d print", "3d printing", "cnc"], "Soldering / SMD rework": ["soldering", "smd", "reflow"],
  "Oscilloscope & lab testing": ["oscilloscope", "multimeter", "logic analyzer"], "IoT / sensors": ["iot", "sensor", "mqtt", "node-red", "nodered"],
};
export const DOMAIN_HINTS = {
  "Logistics / freight": ["logistics", "freight", "shipment", "transport", "courier", "fleet", "dispatch", "expediting"],
  "Supply chain / warehousing": ["supply chain", "warehouse", "procurement", "vendor"], "ERP / accounting": ["erp", "sap", "accounting", "tally", "ledger"],
  "Inventory": ["inventory", "stock"], "GST / invoicing": ["gst", "invoice", "invoicing", "billing"], "E-commerce": ["e-commerce", "ecommerce"],
  "Fintech / payments": ["fintech", "payments", "upi"], "B2B SaaS": ["saas", "b2b"],
  "EV / mobility": ["electric vehicle", " ev ", "mobility"], "Energy / solar": ["solar", "photovoltaic", "pv system", "renewable", "substation", "grid"],
  "Battery systems": ["battery"], "Robotics": ["robot", "robotics", "pan-tilt"], "Drones": ["drone", "uav", "quadcopter", "aero"],
  "Consumer electronics": ["consumer electronics"], "Industrial automation": ["plc", "scada", "automation", "industrial"],
};

const has = (text, word) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").trim()}(?![a-z0-9])`, "i").test(text);

/** First number after `labels`, within `span` chars, as a mark (percentage or CGPA). */
function markNear(text, labels, span = 160) {
  const re = new RegExp(`(?:${labels})`, "ig");
  let m;
  while ((m = re.exec(text))) {
    const window = text.slice(m.index, m.index + span);
    // prefer an explicit percentage, then a "CGPA/GPA: x", then a bare decimal
    const pct = /(\d{2}(?:\.\d{1,2})?)\s*%/.exec(window);
    if (pct) return Number(pct[1]);
    const gpa = /(?:c?gpa|cpi|sgpa)\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?)/i.exec(window) || /(\d{1,2}\.\d{1,2})\s*(?:\/\s*10|cgpa|gpa)/i.exec(window);
    if (gpa && Number(gpa[1]) <= 10) return Number(gpa[1]);
    const pctWord = /(?:percentage|marks|score)\s*[:\-]?\s*(\d{2}(?:\.\d{1,2})?)/i.exec(window);
    if (pctWord) return Number(pctWord[1]);
  }
  return null;
}

export function parseResume(raw) {
  const text = String(raw || "").replace(/\r/g, "");
  // pdf.js sometimes splits decimals into two runs ("8. 27"); glue them back
  const flat = text.replace(/\s+/g, " ").replace(/(\d)\.\s(\d{1,2})(?!\d)/g, "$1.$2");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = { skills: [], domains: [] };

  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(flat);
  if (email) out.email = email[0].toLowerCase();

  const phone = /(?:\+?91[\s-]*)?(?<![\d])([6-9]\d{4}[\s-]?\d{5})(?![\d])/.exec(flat);
  if (phone) out.phone = "+91 " + phone[1].replace(/[\s-]/g, "").replace(/^(\d{5})(\d{5})$/, "$1 $2");

  const url = (re) => { const m = re.exec(flat); return m ? m[0].replace(/[).,;]+$/, "") : ""; };
  const li = url(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_\-%]+/i);
  const gh = url(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_\-]+/i);
  if (li) out.linkedin = li.toLowerCase();
  if (gh) out.github = gh;
  const other = (flat.match(/https?:\/\/[^\s|,]+/gi) || []).find((u) => !/linkedin|github|mailto/i.test(u));
  if (other) out.portfolio = other.replace(/[).,;]+$/, "");

  // name: first short line of 2-4 words, letters only, near the top
  for (const l of lines.slice(0, 8)) {
    const clean = l.replace(/\s+/g, " ").trim();
    if (/^[A-Za-z][A-Za-z.'\- ]{2,40}$/.test(clean) && clean.split(" ").length >= 2 && clean.split(" ").length <= 4 &&
        !/resume|curriculum|vitae|profile|classification|general use/i.test(clean)) {
      out.fullName = clean.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
      break;
    }
  }

  // branch (order matters: "electrical and electronics" before "electronics")
  if (/electrical\s*(?:&|and)\s*electronics|\bEEE\b/i.test(flat)) out.branch = "EEE";
  else if (/electronics\s*(?:&|and)\s*(?:tele)?communication|\bECE\b|\bE&TC\b|\bEXTC\b/i.test(flat)) out.branch = "ECE";
  else if (/computer\s*science|\bCSE\b|\bCS\b(?!S)/i.test(flat)) out.branch = "CSE";
  else if (/information\s*technology|\bB\.?\s?Tech\.?\s*\(?IT\)?|\bIT\b(?=\s*(?:branch|engineering|\)))/i.test(flat)) out.branch = "IT";

  if (/\bM\.?\s?Tech\b|\bM\.?E\.?\b(?=\s)/i.test(flat)) out.degree = "M.Tech / M.E.";
  else if (/\bB\.?\s?Tech\b|\bB\.?E\.?\b(?=\s)|bachelor of (?:technology|engineering)/i.test(flat)) out.degree = "B.Tech / B.E.";
  else if (/\bMCA\b|\bBCA\b/i.test(flat)) out.degree = "BCA / MCA";
  else if (/\bdiploma\b/i.test(flat)) out.degree = "Diploma";

  const college = lines.find((l) => /(institute of technology|university|college of engineering|engineering college|\bIIT\b|\bNIT\b|\bIIIT\b|\bBITS\b|institute)/i.test(l) && !/kendriya|vidyalaya|school/i.test(l));
  if (college) out.college = college.replace(/\s+/g, " ").replace(/\s*(?:19|20)\d{2}\s*[-–]\s*(?:(?:19|20)\d{2}|present)\s*$/i, "").replace(/[,|]\s*$/, "").trim().slice(0, 160);

  // graduation year: end of the degree's year range
  const degreeAt = flat.search(/\bB\.?\s?Tech\b|\bB\.E\.?\b|\bbachelor|\bM\.?\s?Tech\b/i);
  const yearRange = /(?:19|20)\d{2}\s*[-–]\s*((?:19|20)\d{2})/g;
  let ym, bestGap = Infinity;
  while ((ym = yearRange.exec(flat))) {
    const gap = degreeAt === -1 ? 0 : Math.abs(ym.index - degreeAt);
    if (gap < 260 && gap < bestGap) { bestGap = gap; out.gradYear = Number(ym[1]); }
  }

  out.class10 = markNear(flat, "class\\s*x\\b(?!i)|class\\s*10|10th|\\bssc\\b|matricul|secondary school certificate|\\bx\\s*(?:th|standard)\\b|\\(class x\\)");
  out.class12 = markNear(flat, "class\\s*xii|class\\s*12|12th|\\bhsc\\b|intermediate|senior secondary|higher secondary|\\bpuc\\b|\\bxii\\b");
  // degree grade: an explicit CGPA/CPI first, else a percentage right after the degree name
  const gpa = /\b(?:c\.?g\.?p\.?a|cpi|gpa)\b\s*(?:of|[:\-=])?\s*(\d{1,2}(?:\.\d{1,2})?)/i.exec(flat) ||
    /(\d\.\d{1,2})\s*(?:\/\s*10\b|cgpa|cpi)/i.exec(flat);
  if (gpa && Number(gpa[1]) <= 10) out.cgpa = Number(gpa[1]);
  else if (degreeAt !== -1) {
    const m = /(\d{2}(?:\.\d{1,2})?)\s*%/.exec(flat.slice(degreeAt, degreeAt + 140));
    if (m && Number(m[1]) !== out.class10 && Number(m[1]) !== out.class12) out.cgpa = Number(m[1]);
  }

  const exp = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:work\s+|professional\s+|industry\s+)?experience/i.exec(flat);
  if (exp) out.experienceYears = Number(exp[1]);
  else {
    // sum date ranges under an experience heading, e.g. "December 2024 – ONGOING"
    const expAt = flat.search(/work experience|experience|employment/i);
    const tail = expAt === -1 ? "" : flat.slice(expAt, expAt + 2500);
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const rng = /([A-Za-z]{3})[a-z]*\.?\s+((?:19|20)\d{2})\s*[-–]\s*(?:([A-Za-z]{3})[a-z]*\.?\s+((?:19|20)\d{2})|(present|ongoing|current|now|till date))/gi;
    let r, total = 0;
    const now = new Date();
    while ((r = rng.exec(tail))) {
      const s = months[r[1].toLowerCase()]; if (s === undefined) continue;
      const start = Number(r[2]) * 12 + s;
      const end = r[5] ? now.getFullYear() * 12 + now.getMonth() : Number(r[4]) * 12 + (months[(r[3] || "").toLowerCase()] ?? 11);
      const span = end - start;
      // internships of a few months do not count as experience
      if (span >= 6 && span < 600) total += span;
    }
    if (total) out.experienceYears = Math.round((total / 12) * 2) / 2;
  }

  let city = null;
  for (const l of lines.slice(0, 8)) {
    if (/school|college|institute|university|vidyalaya|academy/i.test(l)) continue;
    city = CITIES.find((c) => has(l, c.toLowerCase())) || null;
    if (city) break;
  }
  if (city) out.city = city;

  const low = " " + flat.toLowerCase() + " ";
  for (const [label, words] of Object.entries(SKILL_HINTS)) if (words.some((w) => has(low, w))) out.skills.push(label);
  for (const [label, words] of Object.entries(DOMAIN_HINTS)) if (words.some((w) => (w.startsWith(" ") ? low.includes(w) : has(low, w)))) out.domains.push(label);

  for (const k of Object.keys(out)) if (out[k] === null || out[k] === undefined || out[k] === "") delete out[k];
  return out;
}
