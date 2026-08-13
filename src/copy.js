import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function normalize(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function comparisonKey(value) {
  return normalize(value).toLocaleLowerCase();
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function likelyCodeString(value) {
  if (!value || !/[\p{L}\p{N}]/u.test(value)) return true;
  if (/^(?:https?:|data:|\.\.?\/|@|#)/i.test(value)) return true;
  if (/\.(?:[cm]?[jt]sx?|css|s[ac]ss|svg|png|jpe?g|webp|json|woff2?)(?:\?.*)?$/i.test(value)) return true;
  return false;
}

function addCandidate(candidates, sourcePath, source, value, index, kind) {
  const normalized = normalize(value);
  if (likelyCodeString(normalized)) return;
  const key = comparisonKey(normalized);
  const location = { file: sourcePath, line: lineAt(source, index), kind };
  const existing = candidates.get(key);
  if (existing) {
    existing.locations.push(location);
    return;
  }
  candidates.set(key, { value: normalized, locations: [location] });
}

function extractVisibleCopy(sourcePath, source) {
  const candidates = new Map();

  const openingTag = /<(?:[A-Za-z][\w.:]*|>)(?:[^<>{"']|"[^"]*"|'[^']*'|\{[^{}]*\})*>([^<>{}\n]+)/g;
  for (const match of source.matchAll(openingTag)) {
    addCandidate(candidates, sourcePath, source, match[1], match.index + match[0].indexOf(match[1]), "jsx-text");
  }
  for (const match of source.matchAll(/\}([^<>{}\n]+)(?=<)/g)) {
    addCandidate(candidates, sourcePath, source, match[1], match.index + 1, "jsx-text-after-expression");
  }

  for (const match of source.matchAll(/\b(placeholder|title|alt)\s*=\s*(["'])(.*?)\2/gs)) {
    addCandidate(candidates, sourcePath, source, match[3], match.index, `attribute:${match[1]}`);
  }

  const literalPatterns = [
    /"((?:\\.|[^"\\])*)"/g,
    /'((?:\\.|[^'\\])*)'/g,
    /`((?:\\.|[^`\\])*)`/g,
  ];
  for (const pattern of literalPatterns) {
    for (const match of source.matchAll(pattern)) {
      const value = normalize(match[1]);
      if (!value || value.includes("${") || likelyCodeString(value)) continue;
      const context = source.slice(Math.max(0, match.index - 160), match.index);
      if (/\b(?:from|import|require)\s*(?:\(|$)[^\n]*$/m.test(context)) continue;
      if (/(?:className|id|key|role|type|name|href|src|htmlFor|viewBox|d|fill|stroke|xmlns|aria-[\w-]+|data-[\w-]+)\s*=\s*$/m.test(context)) continue;
      const words = value.split(/\s+/).filter(Boolean);
      const looksUserFacing = words.length > 1
        || /^[\p{Lu}\p{Lt}][\p{L}\p{M}\p{N}….,!?+&/()'’-]*$/u.test(value)
        || /[^\x00-\x7F]/.test(value);
      if (!looksUserFacing) continue;
      addCandidate(candidates, sourcePath, source, value, match.index, "string-literal");
    }
  }

  return [...candidates.values()];
}

function evidenceStrings(evidence) {
  const states = evidence?.states ?? (evidence?.state ? [evidence.state] : []);
  return states
    .flatMap((state) => state.visibleText ?? [])
    .map((row) => normalize(row?.value))
    .filter(Boolean);
}

function isCovered(candidate, approved) {
  const key = comparisonKey(candidate);
  return approved.some((value) => {
    const approvedKey = comparisonKey(value);
    return key === approvedKey || approvedKey.includes(key);
  });
}

export async function checkImplementationCopy(evidencePath, sourcePaths, { allow = [], evidencePaths = [] } = {}) {
  if (!evidencePath) throw new Error("copy-check requires a visible-evidence.json path");
  if (!sourcePaths?.length) throw new Error("copy-check requires at least one JSX/TSX source file");

  const resolvedEvidence = [evidencePath, ...evidencePaths].map((path) => resolve(path));
  const evidence = await Promise.all(resolvedEvidence.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  const visible = [...new Set(evidence.flatMap(evidenceStrings))];
  if (!visible.length) throw new Error(`No visible text found in evidence: ${resolvedEvidence.join(", ")}`);
  const allowed = [...new Set((allow ?? []).map(normalize).filter(Boolean))];
  const approved = [...visible, ...allowed];
  const checked = [];

  for (const path of sourcePaths) {
    const resolvedPath = resolve(path);
    const source = await readFile(resolvedPath, "utf8");
    checked.push(...extractVisibleCopy(resolvedPath, source));
  }

  const allViolations = checked.filter((candidate) => !isCovered(candidate.value, approved));
  const violations = allViolations.slice(0, 20).map((candidate) => ({
    ...candidate,
    locations: candidate.locations.slice(0, 1),
  }));
  return {
    ok: allViolations.length === 0,
    evidence: resolvedEvidence,
    sourceFiles: [...new Set(sourcePaths.map((path) => resolve(path)))],
    visibleEvidenceStrings: visible.length,
    screenshotAllowlistStrings: allowed.length,
    checkedStrings: checked.length,
    violationCount: allViolations.length,
    violationsTruncated: allViolations.length > violations.length,
    violations,
    instruction: allViolations.length
      ? "Remove invented UI copy/data, select the correct visible state, or allow only exact strings personally read from a viewed source-size detail screenshot. Do not use --allow for guessed content."
      : "Copy gate passed. This proves string provenance only; visual comparison against the baseline screenshot is still required.",
  };
}
