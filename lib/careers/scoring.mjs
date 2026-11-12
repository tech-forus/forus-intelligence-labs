// Fit scoring for careers applications.
//
// Three tracks, each scored 0-100 from what the applicant ticked on the form plus
// keywords found in their resume text and "what have you built" answer:
//
//   freightcompare  MERN + logistics / freight / supply-chain domain knowledge
//   forusbiz        MERN + ERP / accounting / inventory / GST domain knowledge
//   hardware        hands-on electronics + proof of having actually built things
//
// Every score comes with the list of signals that produced it, so the admin
// page can show *why* someone ranked where they did. Keep the weights here
// simple and readable; this is a sorting aid, not a hiring decision.

const SOFTWARE_BRANCHES = ["CSE", "IT", "EEE"];
const HARDWARE_BRANCHES = ["EEE", "ECE"];

// [label, ...patterns]. A pattern is matched case-insensitively on word edges.
const MERN = [
  ["MongoDB", "mongodb", "mongo", "mongoose"],
  ["Express", "express", "express.js", "expressjs"],
  ["React", "react", "react.js", "reactjs", "react native", "next.js", "nextjs"],
  ["Node.js", "node", "node.js", "nodejs"],
];
const SOFTWARE_EXTRAS = [
  ["TypeScript", "typescript"],
  ["REST APIs", "rest api", "rest apis", "restful"],
  ["Redis", "redis"],
  ["SQL", "postgres", "postgresql", "mysql", "sql"],
  ["Docker", "docker"],
  ["AWS / cloud", "aws", "gcp", "azure", "railway", "vercel", "netlify"],
  ["Testing", "jest", "vitest", "playwright", "cypress", "unit tests"],
  ["LLM / AI", "llm", "openai", "langchain", "rag", "gpt", "machine learning"],
  ["Android / mobile", "android", "capacitor", "flutter", "kotlin"],
];
const LOGISTICS = [
  ["Logistics", "logistics"],
  ["Freight", "freight", "ftl", "ltl", "part load", "full truck load"],
  ["Shipping", "shipment", "shipments", "shipping", "consignment"],
  ["Transport", "transport", "transportation", "trucking", "truck", "lorry"],
  ["Fleet", "fleet", "fleet management", "vehicle tracking", "gps tracking"],
  ["Courier / last mile", "courier", "last mile", "last-mile", "delivery app", "hyperlocal"],
  ["Supply chain", "supply chain", "supply-chain", "scm", "3pl"],
  ["Warehouse", "warehouse", "warehousing", "wms"],
  ["TMS / dispatch", "tms", "dispatch", "route optimization", "route optimisation"],
  ["Indian logistics players", "delhivery", "porter", "shiprocket", "blackbuck", "rivigo", "wheelseye", "dtdc", "bluedart", "ecom express", "xpressbees"],
];
const ERP = [
  ["ERP", "erp", "odoo", "sap", "zoho", "netsuite"],
  ["Accounting", "accounting", "ledger", "double entry", "double-entry", "trial balance", "balance sheet", "tally"],
  ["Inventory", "inventory", "stock management", "sku"],
  ["Invoicing / billing", "invoice", "invoicing", "billing", "e-invoice", "proforma"],
  ["GST / tax", "gst", "tds", "taxation"],
  ["CRM / sales", "crm", "sales pipeline", "lead management"],
  ["Procurement", "procurement", "purchase order", "purchase orders", "vendor management"],
  ["Multi-tenant SaaS", "saas", "multi-tenant", "multitenant", "rbac", "role-based access"],
  ["Manufacturing ops", "bom", "bill of materials", "production planning", "mrp"],
];
const HARDWARE = [
  ["PCB design", "pcb", "kicad", "altium", "eagle", "easyeda", "orcad", "schematic", "pcb layout"],
  ["Embedded / firmware", "embedded", "firmware", "microcontroller", "rtos", "freertos", "bare metal", "bare-metal"],
  ["MCU platforms", "stm32", "esp32", "esp8266", "arduino", "avr", "pic", "nrf52", "raspberry pi", "teensy"],
  ["Power electronics", "power electronics", "smps", "buck", "boost", "inverter", "mosfet", "gate driver", "mppt", "dc-dc"],
  ["Battery / BMS / EV", "bms", "battery management", "li-ion", "lithium", "battery pack", "ev", "electric vehicle", "charger"],
  ["Motor control", "motor control", "bldc", "foc", "pmsm", "stepper", "servo", "vfd"],
  ["Comms buses", "can bus", "canbus", "i2c", "spi", "uart", "modbus", "rs485", "ble", "lora"],
  ["FPGA / HDL", "fpga", "verilog", "vhdl"],
  ["Simulation", "ltspice", "simulink", "matlab", "proteus", "pspice", "multisim"],
  ["Mechanical CAD", "solidworks", "fusion 360", "fusion360", "autocad", "catia", "creo", "onshape", "cad"],
  ["Fabrication", "3d printing", "3d printer", "3d printed", "cnc", "laser cutting", "soldering", "smd", "reflow"],
  ["Test & measurement", "oscilloscope", "multimeter", "logic analyzer", "logic analyser", "spectrum analyzer"],
  ["IoT / sensors", "iot", "sensor", "sensors", "mqtt"],
];
// Evidence of being an actual maker rather than someone who lists tools.
const MAKER = [
  ["Built a prototype", "prototype", "prototyped", "built", "designed and built", "fabricated", "assembled"],
  ["Robotics", "robot", "robotics", "robocon", "drone", "quadcopter", "rover"],
  ["Competitions", "sae", "baja", "formula student", "supra", "efficycle", "hackathon", "smart india hackathon", "e-yantra", "eyantra"],
  ["Shipped / sold", "shipped", "in production", "customers", "sold", "deployed", "mass production", "startup"],
  ["Patent / paper", "patent", "published", "ieee"],
  ["Open hardware", "open source hardware", "open-source hardware", "hackaday", "instructables", "tindie"],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compiled = new Map();
function re(pattern) {
  let r = compiled.get(pattern);
  if (!r) {
    // word-ish edges that still let "node.js", "c++", "3d printing" match
    r = new RegExp(`(?:^|[^a-z0-9])${esc(pattern)}(?![a-z0-9])`, "i");
    compiled.set(pattern, r);
  }
  return r;
}

/** Labels from `groups` that appear in `text`. */
export function matchGroups(text, groups) {
  const hits = [];
  for (const [label, ...patterns] of groups) {
    if (patterns.some((p) => re(p).test(text))) hits.push(label);
  }
  return hits;
}

const frac = (n, of) => Math.min(n, of) / of;
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Score one application.
 * @param {object} a   normalised application (see validate.mjs)
 * @param {string} resumeText  extracted resume text ('' if unreadable)
 */
export function scoreApplication(a, resumeText = "") {
  const corpus = [
    (a.skills || []).join(" , "),
    (a.domains || []).join(" , "),
    a.built || "",
    a.currentRole || "",
    resumeText || "",
  ].join("\n").toLowerCase();

  const yrs = Number(a.experienceYears) || 0;
  const hasCode = Boolean(a.links?.github);
  const hasPortfolio = Boolean(a.links?.portfolio);

  // ---- software tracks ----
  const mern = matchGroups(corpus, MERN);
  const extras = matchGroups(corpus, SOFTWARE_EXTRAS);
  const logistics = matchGroups(corpus, LOGISTICS);
  const erp = matchGroups(corpus, ERP);
  const swBranch = SOFTWARE_BRANCHES.includes(a.branch);

  const swBase =
    frac(mern.length, 4) * 38 +          // the stack both products run on
    frac(extras.length, 4) * 10 +
    frac(yrs, 4) * 14 +
    (swBranch ? 5 : 0) +
    (hasCode ? 5 : 0);

  const fc = clamp(swBase + frac(logistics.length, 3) * 28);
  const fb = clamp(swBase + frac(erp.length, 3) * 28);

  // ---- hardware track ----
  const hw = matchGroups(corpus, HARDWARE);
  const maker = matchGroups(corpus, MAKER);
  const hwBranch = HARDWARE_BRANCHES.includes(a.branch);
  const hwScore = clamp(
    frac(hw.length, 6) * 40 +
    frac(maker.length, 3) * 25 +
    frac(yrs, 3) * 10 +
    (hwBranch ? 10 : 0) +
    (hasPortfolio || hasCode ? 10 : 0) +
    ((a.built || "").trim().length >= 120 ? 5 : 0)   // wrote a real answer
  );

  const tags = [];
  if (mern.length >= 3) tags.push("MERN");
  if (logistics.length) tags.push("Logistics");
  if (erp.length) tags.push("ERP / accounting");
  if (hw.includes("PCB design")) tags.push("PCB");
  if (hw.includes("Embedded / firmware") || hw.includes("MCU platforms")) tags.push("Embedded");
  if (hw.includes("Power electronics") || hw.includes("Battery / BMS / EV")) tags.push("Power / EV");
  if (maker.length >= 2) tags.push("Maker");
  if (yrs >= 3) tags.push("3+ yrs");
  if (yrs === 0) tags.push("Fresher");

  const eligible = a.role === "hardware" ? hwBranch : swBranch;

  return {
    freightcompare: { score: fc, signals: [...mern, ...logistics, ...extras] },
    forusbiz: { score: fb, signals: [...mern, ...erp, ...extras] },
    hardware: { score: hwScore, signals: [...hw, ...maker] },
    tags,
    eligibleBranch: eligible,
    best: a.role === "hardware" ? "hardware" : fc >= fb ? "freightcompare" : "forusbiz",
  };
}

export const BRANCHES = { software: SOFTWARE_BRANCHES, hardware: HARDWARE_BRANCHES };
