import { createHash } from "node:crypto";
import { isNodeVisible } from "./simplify.js";

const CANDIDATE_TYPES = new Set(["SECTION", "FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "GROUP"]);
const NON_DESIGN_KINDS = new Set(["annotation", "element"]);
const ANNOTATION_NAME = /(?:^|\b)(?:annotation|connector|decision|doc typo|flow arrow|flow shape|flow status|note|prototype link|wire)(?:\b|$)/i;
const DIALOG_NAME = /(?:^|\b)(?:dialog|modal|drawer|popup|sheet)(?:\b|$)/i;
const SCREEN_NAME = /(?:^|\b)(?:dashboard|default|detail|desktop|empty|error|home|landing|list|mobile|page|profile|screen|state|success|tab)(?:\b|$)/i;
const GENERIC_NAME = /^(?:container|content|frame|group|main|section|wrapper)$/i;
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "design", "for", "from", "i", "implement", "implementation",
  "in", "is", "it", "me", "need", "of", "on", "or", "please", "that", "the", "this", "to", "using",
  "want", "where", "which", "with", "you", "your", "user", "can", "could", "actual", "correct", "related",
  "screen", "page", "view", "flow", "component", "element", "container", "wrapper",
  "cac", "cai", "can", "cho", "co", "cua", "de", "duoc", "la", "mot", "nay", "nhung", "toi", "va", "voi",
]);

const ALIAS_GROUPS = [
  ["add", "create", "creates", "created", "creating", "creation", "new", "tao", "them"],
  ["edit", "modify", "update", "chinh", "sua", "cap nhat"],
  ["delete", "remove", "archive", "xoa"],
  ["segment", "segmentation", "audience", "cohort", "phan khuc"],
  ["candidate", "applicant", "talent", "ung vien"],
  ["filter", "filters", "filtering", "criteria", "condition", "loc", "bo loc", "dieu kien"],
  ["smart", "intelligent", "ai", "thong minh"],
  ["search", "find", "lookup", "tim", "tim kiem"],
  ["preview", "review", "xem", "xem truoc"],
  ["import", "upload", "spreadsheet", "excel", "xlsx", "xls", "nhap", "tai len"],
  ["export", "download", "xuat", "tai xuong"],
  ["campaign", "outreach", "email", "chien dich"],
  ["login", "signin", "sign in", "dang nhap"],
  ["signup", "register", "sign up", "dang ky"],
  ["settings", "preferences", "configuration", "config", "cai dat", "thiet lap"],
  ["profile", "account", "ho so", "tai khoan"],
  ["dashboard", "overview", "home", "tong quan", "trang chu"],
  ["list", "table", "listing", "danh sach"],
  ["detail", "details", "view", "chi tiet"],
  ["modal", "dialog", "popup", "overlay", "drawer", "sheet"],
  ["screen", "page", "view", "flow", "man hinh", "trang"],
  ["component", "control", "widget", "element", "thanh phan"],
  ["submit", "save", "confirm", "apply", "luu", "xac nhan", "ap dung"],
  ["cancel", "close", "dismiss", "huy", "dong", "bo qua"],
  ["initial", "start", "empty", "blank", "default", "begin", "trong", "khong co du lieu"],
  ["error", "failure", "invalid", "loi", "khong hop le"],
  ["success", "complete", "completed", "thanh cong", "hoan tat"],
];

export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function tokenize(value, { keepStopWords = false } = {}) {
  const tokens = normalizeSearchText(value).split(/\s+/).filter(Boolean);
  return keepStopWords ? tokens : tokens.filter((token) => !STOP_WORDS.has(token));
}

const ALIAS_MAP = (() => {
  const map = new Map();
  for (const group of ALIAS_GROUPS) {
    const words = new Set(group.flatMap((phrase) => tokenize(phrase, { keepStopWords: true })));
    for (const word of words) {
      const current = map.get(word) ?? new Set([word]);
      for (const alias of words) current.add(alias);
      map.set(word, current);
    }
  }
  return map;
})();

function expandToken(token) {
  return [...(ALIAS_MAP.get(token) ?? new Set([token]))];
}

function clippedJoin(parts, limit) {
  const result = [];
  let length = 0;
  for (const value of parts.filter(Boolean)) {
    const clean = String(value).replace(/\s+/g, " ").trim();
    if (!clean) continue;
    if (length + clean.length + 1 > limit) {
      const remaining = limit - length - 1;
      if (remaining > 12) result.push(clean.slice(0, remaining));
      break;
    }
    result.push(clean);
    length += clean.length + 1;
  }
  return result.join(" · ");
}

function candidateKind(node) {
  const name = normalizeSearchText(node.name);
  const bounds = node.bounds;
  const width = bounds?.width ?? 0;
  const height = bounds?.height ?? 0;
  const aspectRatio = height > 0 ? width / height : 0;

  if (ANNOTATION_NAME.test(name)) return "annotation";
  if (width > 0 && height > 0 && (width < 80 || height < 80)) return "element";
  if (DIALOG_NAME.test(name)) return "dialog";
  if (node.type === "SECTION") return "section";
  if (
    SCREEN_NAME.test(name) ||
    (width >= 800 && height >= 560 && aspectRatio >= 0.45 && aspectRatio <= 2.8)
  ) return "screen";
  if (width >= 280 && height >= 160 && (node.childCount ?? 0) > 0) return "component";
  return "element";
}

function structuralQuality(node, depth, descendantCount) {
  const bounds = node.bounds;
  const area = bounds ? bounds.width * bounds.height : 0;
  let score = {
    SECTION: 7,
    FRAME: 6,
    COMPONENT: 5,
    COMPONENT_SET: 4,
    INSTANCE: 4,
    GROUP: 2,
  }[node.type] ?? 0;
  if (depth === 1) score += 5;
  else if (depth === 2) score += 3;
  else if (depth === 0) score -= 8;
  if (area >= 120_000) score += 3;
  else if (area >= 30_000) score += 2;
  else if (area > 0 && area < 2_500) score -= 3;
  if ((node.childCount ?? 0) >= 2) score += 2;
  if (descendantCount >= 5) score += 1;
  if (descendantCount > 500) score -= 3;
  if (node.visible === false) score -= 8;
  const kind = candidateKind(node);
  score += {
    screen: 10,
    dialog: 9,
    section: 5,
    component: 3,
    element: -3,
    annotation: -24,
  }[kind];
  if (GENERIC_NAME.test(normalizeSearchText(node.name))) score -= 5;
  return score;
}

function analyzeNode(node, depth, path, candidates, ancestorIds = []) {
  if (!isNodeVisible(node)) return { count: 0, text: "", names: "" };
  const childAnalyses = (node.children ?? []).map((child) =>
    analyzeNode(child, depth + 1, [...path, node.name], candidates, [...ancestorIds, node.id]));
  const ownText = node.text?.value ?? "";
  const directNames = clippedJoin((node.children ?? []).map((child) => child.name), 500);
  const descendantText = clippedJoin([
    ownText,
    ...childAnalyses.map((analysis) => analysis.text),
  ], 1_400);
  const descendantNames = clippedJoin([
    directNames,
    ...childAnalyses.map((analysis) => analysis.names),
  ], 900);
  const descendantCount = childAnalyses.reduce((sum, analysis) => sum + analysis.count, 0);
  const entryPath = [...path, node.name].filter(Boolean);

  if (CANDIDATE_TYPES.has(node.type)) {
    const componentValues = node.component?.properties
      ? Object.values(node.component.properties).map((value) => value?.value ?? value).join(" ")
      : "";
    candidates.push({
      id: node.id,
      name: node.name,
      type: node.type,
      depth,
      path: entryPath.join(" / "),
      ancestorIds,
      bounds: node.bounds,
      childCount: node.childCount ?? 0,
      descendantCount,
      textPreview: descendantText,
      fields: {
        name: normalizeSearchText(node.name),
        // A wrapper's name often carries the product/domain nouns omitted from
        // individual state names (for example, wrapper "Tạo segment" with
        // child "Empty / Start"). Keep that context so natural-language
        // intent can match the state without forcing callers to know Figma's
        // internal naming convention.
        path: normalizeSearchText(entryPath.slice(0, -1).join(" ")),
        directNames: normalizeSearchText(directNames),
        text: normalizeSearchText(descendantText),
        component: normalizeSearchText([node.component?.name, componentValues].filter(Boolean).join(" ")),
        type: normalizeSearchText(node.type),
      },
      kind: candidateKind(node),
      quality: structuralQuality(node, depth, descendantCount),
    });
  }

  return {
    count: descendantCount + 1,
    text: descendantText,
    names: clippedJoin([node.name, descendantNames], 900),
  };
}

export function buildCandidateIndex(spec) {
  const candidates = [];
  for (const root of spec.nodes ?? []) analyzeNode(root, 0, [], candidates);
  const nonRoots = candidates.filter((candidate) => candidate.depth > 0);
  return nonRoots.length ? nonRoots : candidates;
}

function trigrams(token) {
  const padded = `  ${token} `;
  const values = new Set();
  for (let index = 0; index <= padded.length - 3; index += 1) values.add(padded.slice(index, index + 3));
  return values;
}

function fuzzySimilarity(left, right) {
  if (left.length < 4 || right.length < 4) return 0;
  const a = trigrams(left);
  const b = trigrams(right);
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function fieldTokenSet(value) {
  return new Set(tokenize(value, { keepStopWords: true }));
}

function bestTokenMatch(alias, field, tokenSet) {
  if (tokenSet.has(alias)) return 1;
  if (alias.length >= 3 && [...tokenSet].some((token) => token.startsWith(alias) || alias.startsWith(token))) return 0.72;
  let similarity = 0;
  for (const token of tokenSet) similarity = Math.max(similarity, fuzzySimilarity(alias, token));
  return similarity >= 0.48 ? similarity * 0.55 : 0;
}

function scoreCandidate(candidate, query, queryTokens) {
  const tokenSets = Object.fromEntries(Object.entries(candidate.fields).map(([name, value]) => [name, fieldTokenSet(value)]));
  const weights = { name: 11, directNames: 7, text: 5, component: 7, path: 3, type: 2 };
  const matched = [];
  const matchedFields = new Set();
  const why = [];
  let lexicalScore = 0;

  if (query && candidate.fields.name.includes(query)) {
    lexicalScore += 30;
    matchedFields.add("name");
    why.push("query phrase in node name");
  } else if (query && candidate.fields.directNames.includes(query)) {
    lexicalScore += 20;
    matchedFields.add("directNames");
    why.push("query phrase in direct child names");
  } else if (query && candidate.fields.text.includes(query)) {
    lexicalScore += 14;
    matchedFields.add("text");
    why.push("query phrase in visible text");
  }

  for (const queryToken of queryTokens) {
    const aliases = expandToken(queryToken);
    let best = { score: 0, field: undefined, alias: undefined };
    for (const [field, tokenSet] of Object.entries(tokenSets)) {
      for (const alias of aliases) {
        const similarity = bestTokenMatch(alias, candidate.fields[field], tokenSet);
        const exactness = alias === queryToken ? 1 : 0.82;
        const score = similarity * weights[field] * exactness;
        if (score > best.score) best = { score, field, alias };
      }
    }
    if (best.score > 0) {
      lexicalScore += best.score;
      matched.push(queryToken);
      matchedFields.add(best.field);
      if (why.length < 4) {
        const aliasNote = best.alias !== queryToken ? ` via “${best.alias}”` : "";
        why.push(`“${queryToken}” matched ${best.field}${aliasNote}`);
      }
    }
  }

  const coverage = queryTokens.length ? matched.length / queryTokens.length : 0;
  lexicalScore += coverage * 22;
  const specificityPenalty = Math.max(0, Math.log10(Math.max(1, candidate.descendantCount)) - 1.7) * 3;
  const score = lexicalScore + Math.max(-2, candidate.quality * (queryTokens.length ? 0.35 : 1)) - specificityPenalty;
  const confidence = coverage >= 0.75 && lexicalScore >= 25 ? "high" : coverage >= 0.4 && lexicalScore >= 12 ? "medium" : "low";
  if (!queryTokens.length) why.push("ranked as a likely screen or component container");

  return { score, lexicalScore, coverage, confidence, matched, matchedFields: [...matchedFields], why };
}

function publicCandidate(candidate, scored, rank) {
  return {
    rank,
    id: candidate.id,
    name: candidate.name,
    kind: candidate.kind,
    type: candidate.type,
    path: candidate.path,
    depth: candidate.depth,
    bounds: candidate.bounds,
    childCount: candidate.childCount,
    descendantCount: candidate.descendantCount,
    score: Math.round(scored.score * 100) / 100,
    confidence: scored.confidence,
    coverage: Math.round(scored.coverage * 100) / 100,
    why: scored.why,
    textPreview: candidate.textPreview.slice(0, 180),
  };
}

function positionPercent(bounds, rootBounds) {
  if (!bounds || !rootBounds?.width || !rootBounds?.height) return undefined;
  const x = ((bounds.x + bounds.width / 2 - rootBounds.x) / rootBounds.width) * 100;
  const y = ((bounds.y + bounds.height / 2 - rootBounds.y) / rootBounds.height) * 100;
  return `${Math.round(x)}%,${Math.round(y)}%`;
}

function meaningfulContext(candidates, rootBounds) {
  const values = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (candidate.kind !== "annotation") continue;
    const value = candidate.textPreview.replace(/\s+/g, " ").trim();
    if (!value || !/[\p{Letter}\p{Number}]/u.test(value)) continue;
    const clipped = value.slice(0, 120);
    const key = normalizeSearchText(clipped);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push({
      id: candidate.id,
      label: clipped,
      position: positionPercent(candidate.bounds, rootBounds),
    });
    if (values.length >= 8) break;
  }
  return values;
}

const STATEFUL_NAME = /(?:^|\b)(?:async|condition|count|empty|error|fail|first|initial|load|loading|match|no matching|refresh|result|state|success|update|updated)(?:\b|$)/i;

function implementationEntry(state, candidates) {
  const stateArea = (state.bounds?.width ?? 0) * (state.bounds?.height ?? 0);
  if (!stateArea) return undefined;
  return candidates
    .filter((candidate) =>
      candidate.depth === state.depth + 1
      && candidate.ancestorIds.includes(state.id)
      && !NON_DESIGN_KINDS.has(candidate.kind))
    .map((candidate) => ({
      candidate,
      areaRatio: ((candidate.bounds?.width ?? 0) * (candidate.bounds?.height ?? 0)) / stateArea,
      widthRatio: (candidate.bounds?.width ?? 0) / state.bounds.width,
      heightRatio: (candidate.bounds?.height ?? 0) / state.bounds.height,
    }))
    .filter(({ areaRatio, widthRatio, heightRatio }) => areaRatio >= 0.45 && widthRatio >= 0.65 && heightRatio >= 0.65)
    .sort((left, right) => right.areaRatio - left.areaRatio)[0]?.candidate;
}

function stateCatalog(candidates, rootBounds, limit = 20) {
  const candidatesByY = candidates
    .filter((candidate) => candidate.depth === 1 && !NON_DESIGN_KINDS.has(candidate.kind))
    .sort((left, right) =>
      (left.bounds?.y ?? Number.POSITIVE_INFINITY) - (right.bounds?.y ?? Number.POSITIVE_INFINITY));
  const rowTolerance = Math.max(80, (rootBounds?.height ?? 0) * 0.05);
  const rows = [];
  for (const candidate of candidatesByY) {
    const topY = candidate.bounds?.y ?? Number.POSITIVE_INFINITY;
    const row = rows.find((item) => Math.abs(item.topY - topY) <= rowTolerance);
    if (row) {
      row.candidates.push(candidate);
      row.topY = row.candidates.reduce((sum, item) => sum + (item.bounds?.y ?? row.topY), 0) / row.candidates.length;
    } else {
      rows.push({ topY, candidates: [candidate] });
    }
  }

  return rows
    .sort((left, right) => left.topY - right.topY)
    .flatMap((row) => row.candidates.sort((left, right) =>
      (left.bounds?.x ?? Number.POSITIVE_INFINITY) - (right.bounds?.x ?? Number.POSITIVE_INFINITY) ||
      left.name.localeCompare(right.name)))
    .slice(0, limit)
    .map((candidate) => {
      const entry = implementationEntry(candidate, candidates);
      return {
        id: candidate.id,
        name: candidate.name,
        kind: candidate.kind,
        position: positionPercent(candidate.bounds, rootBounds),
        implementationId: entry?.id,
        implementationName: entry?.name,
      };
    });
}

function statefulCollection(states) {
  if (states.length < 3) return false;
  const stateNamed = states.filter((state) => STATEFUL_NAME.test(normalizeSearchText(state.name))).length;
  return stateNamed >= Math.ceil(states.length / 2);
}

function representativeStates(states, limit = 4) {
  if (!states.length) return [];
  const selected = [];
  const add = (state) => {
    if (state && !selected.some((item) => item.id === state.id)) selected.push(state);
  };
  add(states.find((state) => /(?:empty|start|initial|default)/i.test(normalizeSearchText(state.name))) ?? states[0]);
  add(states.find((state) => /(?:loading|async|progress)/i.test(normalizeSearchText(state.name))));
  add(states.find((state) => /(?:count updated|result|success)/i.test(normalizeSearchText(state.name)))
    ?? states.find((state) => /filter updated/i.test(normalizeSearchText(state.name))));
  add(states.find((state) => /(?:no matching|error|fail)/i.test(normalizeSearchText(state.name))));
  for (const state of states) {
    if (selected.length >= limit) break;
    add(state);
  }
  return selected.slice(0, limit);
}

function rectangleDistance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const dx = Math.max(left.x - (right.x + right.width), right.x - (left.x + left.width), 0);
  const dy = Math.max(left.y - (right.y + right.height), right.y - (left.y + left.height), 0);
  return Math.hypot(dx, dy);
}

function applySpatialContext(items) {
  const annotations = items.filter((item) =>
    item.candidate.kind === "annotation" &&
    item.scored.lexicalScore >= 8 &&
    item.scored.matchedFields.some((field) => field !== "path" && field !== "type") &&
    item.candidate.textPreview);
  if (!annotations.length) return [];

  for (const item of items) {
    if (NON_DESIGN_KINDS.has(item.candidate.kind)) continue;
    let nearest;
    for (const annotation of annotations) {
      const distance = rectangleDistance(item.candidate.bounds, annotation.candidate.bounds);
      if (!nearest || distance < nearest.distance) nearest = { annotation, distance };
    }
    if (!nearest || nearest.distance > 800) continue;
    const boost = Math.max(8, 28 - nearest.distance / 35);
    item.scored.score += boost;
    item.scored.contextScore = boost;
    item.scored.contextId = nearest.annotation.candidate.id;
    item.scored.why.unshift(`near matched annotation “${nearest.annotation.candidate.textPreview.slice(0, 60)}”`);
    if (boost >= 16 && item.scored.confidence === "low") item.scored.confidence = "medium";
  }
  return annotations;
}

function distinctContainers(candidates, limit) {
  const selected = [];
  for (const item of candidates) {
    const candidate = item.candidate;
    const overlaps = selected.some((selectedItem) =>
      candidate.ancestorIds.includes(selectedItem.candidate.id) ||
      selectedItem.candidate.ancestorIds.includes(candidate.id));
    if (overlaps) continue;
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function scoutCandidates(spec, intent, { limit = 20 } = {}) {
  const query = normalizeSearchText(intent);
  const queryTokens = [...new Set(tokenize(query))];
  const indexed = buildCandidateIndex(spec);
  const ranked = indexed.map((candidate) => ({ candidate, scored: scoreCandidate(candidate, query, queryTokens) }));
  const matchedAnnotations = queryTokens.length ? applySpatialContext(ranked) : [];
  ranked.sort((left, right) =>
      (matchedAnnotations.length ? (right.scored.contextScore ?? 0) - (left.scored.contextScore ?? 0) : 0) ||
      right.scored.score - left.scored.score ||
      left.candidate.depth - right.candidate.depth ||
      left.candidate.path.localeCompare(right.candidate.path),
  );

  const implementationCandidates = ranked.filter((item) => !NON_DESIGN_KINDS.has(item.candidate.kind));
  const topLevelImplementationCandidates = implementationCandidates.filter((item) => item.candidate.depth === 1);
  const strongMatches = ranked.filter((item) => item.scored.lexicalScore >= 8);
  const strongImplementationMatches = ranked.filter((item) =>
    !NON_DESIGN_KINDS.has(item.candidate.kind) &&
    (item.scored.lexicalScore >= 8 || item.scored.contextScore >= 8));
  const source = queryTokens.length
    ? (strongImplementationMatches.length ? strongImplementationMatches : strongMatches.length ? strongMatches : implementationCandidates)
    : (topLevelImplementationCandidates.length ? topLevelImplementationCandidates : implementationCandidates);
  const selected = distinctContainers(source.length ? source : ranked, limit)
    .map((item, index) => publicCandidate(item.candidate, item.scored, index + 1));

  const topLevelKindCounts = {};
  for (const candidate of indexed.filter((item) => item.depth === 1)) {
    topLevelKindCounts[candidate.kind] = (topLevelKindCounts[candidate.kind] ?? 0) + 1;
  }
  const topLevelDesignCount = Object.entries(topLevelKindCounts)
    .filter(([kind]) => !NON_DESIGN_KINDS.has(kind))
    .reduce((sum, [, count]) => sum + count, 0);

  const states = stateCatalog(indexed, spec.nodes?.[0]?.bounds);
  const isStatefulCollection = statefulCollection(states);
  return {
    intent: String(intent ?? ""),
    normalizedIntent: query,
    queryTokens,
    mode: queryTokens.length
      ? (matchedAnnotations.length ? "spatial-context" : strongMatches.length ? "intent-match" : "structural-fallback")
      : "catalog",
    candidateCount: indexed.length,
    designCandidateCount: implementationCandidates.length,
    topLevelDesignCount,
    topLevelKindCounts,
    states,
    collection: {
      kind: isStatefulCollection ? "stateful-component" : "screen-collection",
      requiresRepresentativeFocusSet: isStatefulCollection,
      representativeStates: isStatefulCollection ? representativeStates(states) : [],
    },
    context: meaningfulContext(indexed, spec.nodes?.[0]?.bounds),
    matchedContext: matchedAnnotations.map((item) => ({
      id: item.candidate.id,
      label: item.candidate.textPreview.slice(0, 120),
    })),
    candidates: selected,
  };
}

export function findSpecNode(spec, nodeId) {
  const stack = [...(spec.nodes ?? [])];
  while (stack.length) {
    const node = stack.pop();
    if (node.id === nodeId) return node;
    if (node.children?.length) stack.push(...node.children);
  }
  return undefined;
}

export function scoutCacheKey(intent) {
  return createHash("sha256").update(normalizeSearchText(intent) || "catalog").digest("hex").slice(0, 12);
}
