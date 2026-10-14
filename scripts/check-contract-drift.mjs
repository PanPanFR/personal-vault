import fs from "node:fs";

function read(p) { return fs.readFileSync(p, "utf8"); }
function fail(msg) { console.error("CONTRACT DRIFT:", msg); process.exit(1); }

function extractArray(src, constName) {
  const re = new RegExp("export const " + constName + " = \\[([\\s\\S]*?)\\] as const;");
  const m = src.match(re);
  if (!m) fail("could not find " + constName);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function extractObjectFields(openapi, section) {
  const re = new RegExp("\\n    " + section + ":", "m");
  const m = openapi.match(re);
  if (!m) fail("openapi missing " + section);
  const start = m.index;
  const rest = openapi.slice(start + 1);
  const nextMatch = rest.match(/\n    [A-Z][A-Za-z]*:/);
  const end = nextMatch ? start + 1 + nextMatch.index : openapi.length;
  const block = openapi.slice(start, end);
  const propsIdx = block.indexOf("      properties:");
  if (propsIdx < 0) fail(section + " has no properties");
  const props = block.slice(propsIdx);
  const keys = [];
  for (const line of props.split("\n")) {
    const mm = line.match(/^        ([A-Za-z0-9_]+):/);
    if (mm) keys.push(mm[1]);
  }
  return keys;
}

const schemas = read("src/lib/schemas.ts");
const errors = read("src/lib/errors.ts");
const openapi = read("openapi.yaml");

const masterTs = extractArray(schemas, "MASTER_ENVELOPE_FIELDS");
const recoveryTs = extractArray(schemas, "RECOVERY_ENVELOPE_FIELDS");
const masterOa = extractObjectFields(openapi, "MasterEnvelope");
const recoveryOa = extractObjectFields(openapi, "RecoveryEnvelope");

function sameSet(a, b, label) {
  if ([...a].sort().join(",") !== [...b].sort().join(",")) {
    fail(label + " mismatch: ts=[" + a.join(", ") + "] oa=[" + b.join(", ") + "]");
  }
}

sameSet(masterTs, masterOa, "MasterEnvelope fields");
sameSet(recoveryTs, recoveryOa, "RecoveryEnvelope fields");

const errorTs = extractArray(errors, "ERROR_CODES");
if (errorTs.length !== 18) fail("ERROR_CODES must have exactly 18, found " + errorTs.length);

const eoStart = openapi.indexOf("    ErrorEnvelope:");
const eoEndMatch = openapi.slice(eoStart + 1).match(/\n    [A-Z][A-Za-z]*:/);
const eoEnd = eoEndMatch ? eoStart + 1 + eoEndMatch.index : openapi.length;
const eoBlock = openapi.slice(eoStart, eoEnd);
const enumStart = eoBlock.indexOf("          enum:");
const tail = eoBlock.slice(enumStart);
const oaErrors = [...tail.matchAll(/^\s+- ([A-Z_]+)/gm)].map((x) => x[1]);
if (oaErrors.length !== errorTs.length) fail("openapi error enum count " + oaErrors.length + " != " + errorTs.length);
sameSet(errorTs, oaErrors, "Error codes");

console.log("Contract drift check passed.");
console.log("Master: " + masterTs.length + ", Recovery: " + recoveryTs.length + ", Errors: " + errorTs.length);