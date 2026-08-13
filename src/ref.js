const FILE_TYPES = new Set(["design", "file"]);
const FILE_KEY_RE = /^[A-Za-z0-9]+$/;
const NODE_ID_RE = /^I?\d+:\d+(?:;\d+:\d+)*$/;

export function normalizeNodeId(value) {
  const decoded = decodeURIComponent(String(value).trim());
  const normalized = decoded.replace(/(I?\d+)-(\d+)/g, "$1:$2");
  if (!NODE_ID_RE.test(normalized)) {
    throw new Error(`Invalid Figma node ID: ${value}`);
  }
  return normalized;
}

export function parseNodeIds(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => normalizeNodeId(item))
    .filter((item, index, all) => all.indexOf(item) === index);
}

export function parseFigmaRef(value, explicitNodes) {
  const input = String(value).trim();
  const nodes = parseNodeIds(explicitNodes);

  if (FILE_KEY_RE.test(input)) {
    return { fileKey: input, nodeIds: nodes, source: input };
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Expected a Figma /design or /file URL, or an alphanumeric file key");
  }

  if (!(url.hostname === "figma.com" || url.hostname.endsWith(".figma.com"))) {
    throw new Error(`Not a figma.com URL: ${url.hostname}`);
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const typeIndex = parts.findIndex((part) => FILE_TYPES.has(part));
  const fileKey = typeIndex >= 0 ? parts[typeIndex + 1] : undefined;
  if (!fileKey || !FILE_KEY_RE.test(fileKey)) {
    throw new Error("Could not extract a Figma file key from the URL");
  }

  const urlNode = url.searchParams.get("node-id") ?? url.searchParams.get("node_id");
  if (nodes.length === 0 && urlNode) nodes.push(normalizeNodeId(urlNode));

  return { fileKey, nodeIds: nodes, source: input };
}

export function safeTargetName(nodeIds, depth) {
  const target = nodeIds.length ? nodeIds.map((id) => id.replaceAll(":", "-").replaceAll(";", "_")).join("+") : "root";
  return `${target}--d-${depth ?? "all"}`;
}

