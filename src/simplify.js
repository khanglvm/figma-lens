function round(value) {
  return typeof value === "number" ? Math.round(value * 1000) / 1000 : value;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined || item === null) return false;
      if (Array.isArray(item) && item.length === 0) return false;
      if (typeof item === "object" && !Array.isArray(item) && Object.keys(item).length === 0) return false;
      return true;
    }),
  );
}

function colorToHex(color, opacity = 1) {
  if (!color) return undefined;
  const channel = (value) => Math.max(0, Math.min(255, Math.round((value ?? 0) * 255))).toString(16).padStart(2, "0");
  const alpha = channel((color.a ?? 1) * opacity);
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}${alpha === "ff" ? "" : alpha}`;
}

function simplifyPaint(paint) {
  if (!paint || paint.visible === false) return undefined;
  const base = { type: paint.type };
  if (paint.opacity !== undefined && paint.opacity !== 1) base.opacity = round(paint.opacity);
  if (paint.blendMode && paint.blendMode !== "NORMAL") base.blendMode = paint.blendMode;

  if (paint.type === "SOLID") base.color = colorToHex(paint.color);
  if (paint.type === "IMAGE") {
    base.ref = paint.imageRef;
    base.gifRef = paint.gifRef;
    base.scaleMode = paint.scaleMode;
    if (paint.imageTransform) base.transform = paint.imageTransform.map((row) => row.map(round));
  }
  if (paint.type?.startsWith("GRADIENT")) {
    base.stops = paint.gradientStops?.map((stop) => ({
      at: round(stop.position),
      color: colorToHex(stop.color),
    }));
    base.handles = paint.gradientHandlePositions?.map((point) => ({ x: round(point.x), y: round(point.y) }));
  }
  return compactObject(base);
}

function simplifyPaints(paints) {
  return paints?.map(simplifyPaint).filter(Boolean);
}

function simplifyEffect(effect) {
  if (!effect || effect.visible === false) return undefined;
  return compactObject({
    type: effect.type,
    color: colorToHex(effect.color),
    offset: effect.offset && { x: round(effect.offset.x), y: round(effect.offset.y) },
    radius: round(effect.radius),
    spread: round(effect.spread),
    blendMode: effect.blendMode !== "NORMAL" ? effect.blendMode : undefined,
    showShadowBehindNode: effect.showShadowBehindNode,
  });
}

function simplifyBounds(bounds, parentBounds) {
  if (!bounds) return undefined;
  const result = {
    x: round(bounds.x),
    y: round(bounds.y),
    width: round(bounds.width),
    height: round(bounds.height),
  };
  if (parentBounds) {
    result.relativeX = round(bounds.x - parentBounds.x);
    result.relativeY = round(bounds.y - parentBounds.y);
  }
  return result;
}

function simplifyText(node) {
  if (node.type !== "TEXT") return undefined;
  const style = node.style ?? {};
  return compactObject({
    value: node.characters ?? "",
    fontFamily: style.fontFamily,
    fontStyle: style.fontPostScriptName ?? style.fontStyle,
    fontWeight: style.fontWeight,
    fontSize: round(style.fontSize),
    lineHeightPx: round(style.lineHeightPx),
    lineHeightPercent: round(style.lineHeightPercent),
    letterSpacing: round(style.letterSpacing),
    horizontalAlign: style.textAlignHorizontal,
    verticalAlign: style.textAlignVertical,
    case: style.textCase,
    decoration: style.textDecoration,
    autoResize: style.textAutoResize,
    paragraphSpacing: round(style.paragraphSpacing),
    paragraphIndent: round(style.paragraphIndent),
    listSpacing: round(style.listSpacing),
    hyperlink: node.hyperlink,
    styleOverrides: node.styleOverrideTable,
    characterStyleOverrides: node.characterStyleOverrides,
  });
}

function simplifyLayout(node) {
  const individualStrokes = node.individualStrokeWeights;
  return compactObject({
    mode: node.layoutMode,
    wrap: node.layoutWrap,
    itemSpacing: round(node.itemSpacing),
    counterAxisSpacing: round(node.counterAxisSpacing),
    padding: compactObject({
      top: round(node.paddingTop),
      right: round(node.paddingRight),
      bottom: round(node.paddingBottom),
      left: round(node.paddingLeft),
    }),
    primaryAlign: node.primaryAxisAlignItems,
    counterAlign: node.counterAxisAlignItems,
    primarySizing: node.primaryAxisSizingMode,
    counterSizing: node.counterAxisSizingMode,
    alignSelf: node.layoutAlign,
    grow: round(node.layoutGrow),
    position: node.layoutPositioning,
    minWidth: round(node.minWidth),
    maxWidth: round(node.maxWidth),
    minHeight: round(node.minHeight),
    maxHeight: round(node.maxHeight),
    constraints: node.constraints,
    clipsContent: node.clipsContent,
    overflow: node.overflowDirection,
    strokeWeights: individualStrokes ?? (node.strokeWeight !== undefined ? round(node.strokeWeight) : undefined),
    strokeAlign: node.strokeAlign,
  });
}

function simplifyComponent(node, componentNames) {
  if (!node.componentId && !node.componentProperties && !node.componentPropertyDefinitions) return undefined;
  const simplifyProperties = (properties, { definition = false } = {}) => {
    if (!properties) return undefined;
    return Object.fromEntries(Object.entries(properties).map(([name, property]) => [name, compactObject({
      type: property?.type,
      value: property?.value,
      defaultValue: definition ? property?.defaultValue : undefined,
      variantOptions: definition ? property?.variantOptions : undefined,
      preferredValueCount: property?.preferredValues?.length || undefined,
      boundVariables: property?.boundVariables,
    })]));
  };
  return compactObject({
    id: node.componentId,
    name: node.componentId ? componentNames.get(node.componentId) : undefined,
    properties: simplifyProperties(node.componentProperties),
    definitions: simplifyProperties(node.componentPropertyDefinitions, { definition: true }),
  });
}

export function simplifyNode(node, context = {}) {
  const bounds = node.absoluteBoundingBox ?? node.absoluteRenderBounds;
  const result = compactObject({
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible === false ? false : undefined,
    opacity: node.opacity !== undefined && node.opacity !== 1 ? round(node.opacity) : undefined,
    blendMode: node.blendMode && node.blendMode !== "PASS_THROUGH" && node.blendMode !== "NORMAL" ? node.blendMode : undefined,
    bounds: simplifyBounds(bounds, context.parentBounds),
    rotation: node.rotation ? round(node.rotation) : undefined,
    layout: simplifyLayout(node),
    fills: simplifyPaints(node.fills),
    backgrounds: simplifyPaints(node.backgrounds),
    strokes: simplifyPaints(node.strokes),
    cornerRadius: node.rectangleCornerRadii?.map(round) ?? round(node.cornerRadius),
    effects: node.effects?.map(simplifyEffect).filter(Boolean),
    text: simplifyText(node),
    component: simplifyComponent(node, context.componentNames ?? new Map()),
    styles: node.styles,
    variables: node.boundVariables,
    exportSettings: node.exportSettings,
    isMask: node.isMask,
    childCount: node.children?.length,
  });

  if (node.children?.length) {
    result.children = node.children.map((child) =>
      simplifyNode(child, { ...context, parentBounds: bounds ?? context.parentBounds }),
    );
  }
  return result;
}

function componentNameMap(raw) {
  const map = new Map();
  const sources = raw.nodes ? Object.values(raw.nodes).filter(Boolean) : [raw];
  for (const source of sources) {
    for (const [id, component] of Object.entries(source.components ?? {})) {
      map.set(id, component.name);
    }
  }
  return map;
}

export function rootsFromRaw(raw, nodeIds) {
  if (raw.nodes) {
    return nodeIds.map((id) => raw.nodes[id]?.document).filter(Boolean);
  }
  return raw.document ? [raw.document] : [];
}

export function simplifyResponse(raw, ref) {
  const roots = rootsFromRaw(raw, ref.nodeIds);
  const componentNames = componentNameMap(raw);
  return {
    schemaVersion: 1,
    source: compactObject({
      fileKey: ref.fileKey,
      nodeIds: ref.nodeIds,
      fileName: raw.name,
      lastModified: raw.lastModified,
      version: raw.version,
      role: raw.role,
      editorType: raw.editorType,
    }),
    nodes: roots.map((node) => simplifyNode(node, { componentNames })),
  };
}

export function walkNodes(nodes, visitor, path = []) {
  for (const node of nodes ?? []) {
    const nextPath = [...path, node.name || node.id];
    if (visitor(node, nextPath) === false) return false;
    if (walkNodes(node.children, visitor, nextPath) === false) return false;
  }
  return true;
}

export function isNodeVisible(node) {
  return node?.visible !== false && node?.opacity !== 0;
}

export function walkVisibleNodes(nodes, visitor, path = []) {
  for (const node of nodes ?? []) {
    if (!isNodeVisible(node)) continue;
    const nextPath = [...path, node.name || node.id];
    if (visitor(node, nextPath) === false) return false;
    if (walkVisibleNodes(node.children, visitor, nextPath) === false) return false;
  }
  return true;
}

export function nodeStats(spec) {
  const byType = {};
  let total = 0;
  let text = 0;
  let images = 0;
  walkNodes(spec.nodes, (node) => {
    total += 1;
    byType[node.type] = (byType[node.type] ?? 0) + 1;
    if (node.text?.value) text += 1;
    images += [...(node.fills ?? []), ...(node.backgrounds ?? []), ...(node.strokes ?? [])].filter((paint) => paint.type === "IMAGE").length;
  });
  return { total, text, images, byType };
}

export function visibleNodeStats(spec) {
  const byType = {};
  let total = 0;
  let text = 0;
  let images = 0;
  walkVisibleNodes(spec.nodes, (node) => {
    total += 1;
    byType[node.type] = (byType[node.type] ?? 0) + 1;
    if (node.text?.value) text += 1;
    images += [...(node.fills ?? []), ...(node.backgrounds ?? []), ...(node.strokes ?? [])]
      .filter((paint) => paint.type === "IMAGE").length;
  });
  return { total, text, images, byType };
}

export function searchSpec(spec, query, limit = 20) {
  const terms = String(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = [];
  walkVisibleNodes(spec.nodes, (node, path) => {
    if (matches.length >= limit) return false;
    const haystack = [node.id, node.name, node.type, node.text?.value]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    if (terms.every((term) => haystack.includes(term))) {
      matches.push(compactObject({
        id: node.id,
        name: node.name,
        type: node.type,
        path: path.join(" / "),
        text: node.text?.value,
        bounds: node.bounds,
      }));
    }
    return matches.length < limit;
  });
  return matches;
}

export function specTree(spec, { maxDepth = 8, maxNodes = 300, visibleOnly = false } = {}) {
  const lines = [];
  let count = 0;
  const visit = (nodes, depth) => {
    if (depth > maxDepth) return;
    for (const node of nodes ?? []) {
      if (visibleOnly && !isNodeVisible(node)) continue;
      if (count >= maxNodes) return;
      const size = node.bounds ? ` ${node.bounds.width}x${node.bounds.height}` : "";
      const text = node.text?.value ? ` \"${node.text.value.replace(/\s+/g, " ").slice(0, 80)}\"` : "";
      lines.push(`${"  ".repeat(depth)}- ${node.name} [${node.type} ${node.id}]${size}${text}`);
      count += 1;
      visit(node.children, depth + 1);
    }
  };
  visit(spec.nodes, 0);
  if (count >= maxNodes) lines.push(`… truncated at ${maxNodes} nodes`);
  return lines.join("\n");
}

export function imageRefsFromRaw(raw) {
  const refs = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.visible === false || value.opacity === 0) return;
    if (typeof value.imageRef === "string") refs.add(value.imageRef);
    if (Array.isArray(value)) value.forEach(visit);
    else Object.values(value).forEach(visit);
  };
  for (const root of rootsFromRaw(raw, raw.nodes ? Object.keys(raw.nodes) : [])) visit(root);
  return [...refs];
}

function compactStyleContract(node) {
  return compactObject({
    bounds: node.bounds,
    layout: node.layout,
    fills: node.fills,
    strokes: node.strokes,
    cornerRadius: node.cornerRadius,
    effects: node.effects,
    text: node.text,
  });
}

function contractChild(node) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    ...compactStyleContract(node),
  };
}

function hiddenSubtreeStats(nodes) {
  let hiddenSubtrees = 0;
  let hiddenNodes = 0;
  function count(node) {
    hiddenNodes += 1;
    for (const child of node.children ?? []) count(child);
  }
  function visit(node) {
    if (!isNodeVisible(node)) {
      hiddenSubtrees += 1;
      count(node);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }
  for (const node of nodes ?? []) visit(node);
  return { hiddenSubtrees, hiddenNodes };
}

function visibleCoverage(nodes) {
  const truncated = [];
  walkVisibleNodes(nodes, (node, path) => {
    const expected = node.childCount ?? 0;
    const loaded = node.children?.length ?? 0;
    if (expected > loaded) {
      truncated.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: path.join(" / "),
        expectedChildren: expected,
        loadedChildren: loaded,
        bounds: node.bounds,
      });
    }
    return true;
  });
  return {
    status: truncated.length ? "reported-truncation" : "bounded-unknown",
    note: "Figma may omit childCount on depth-truncated leaves. Treat this as bounded structural coverage, not proof that all screenshot-visible copy is present; use evidence-check for important copy.",
    truncatedNodeCount: truncated.length,
    truncated: truncated.slice(0, 24),
  };
}

export function visibleEvidence(spec, { screenshots = [] } = {}) {
  return {
    schemaVersion: 1,
    source: spec.source,
    fidelityRule: "Copy and state may be implemented only when present in both this visible-layer evidence and the selected-state screenshot. Hidden subtrees are excluded. Never invent replacement labels, counts, data, controls, or interactions.",
    states: (spec.nodes ?? []).map((root, index) => {
      const visibleText = [];
      let visibleNodes = 0;
      walkVisibleNodes([root], (node) => {
        visibleNodes += 1;
        if (node.text?.value) {
          visibleText.push({
            id: node.id,
            value: node.text.value,
            at: node.bounds
              ? `${node.bounds.relativeX ?? node.bounds.x},${node.bounds.relativeY ?? node.bounds.y} ${node.bounds.width}x${node.bounds.height}`
              : undefined,
          });
        }
        return true;
      });
      const hidden = hiddenSubtreeStats([root]);
      const coverage = visibleCoverage([root]);
      return {
        id: root.id,
        name: root.name,
        type: root.type,
        bounds: root.bounds,
        screenshot: screenshots[index],
        visibleNodes,
        visibleTextCount: visibleText.length,
        ...hidden,
        coverage,
        visibleText,
      };
    }),
  };
}

export function visibleTextRows(spec) {
  return visibleEvidence(spec).states.flatMap((state) => state.visibleText);
}

export function evidenceCoverage(spec, screenshotText = []) {
  const exact = new Set(visibleTextRows(spec).map((row) => row.value.replace(/\s+/g, " ").trim()));
  const normalizedScreenshot = [...new Set((screenshotText ?? [])
    .map((value) => String(value).replace(/\s+/g, " ").trim())
    .filter(Boolean))];
  const missingFromData = normalizedScreenshot.filter((value) => !exact.has(value));
  const presentInData = normalizedScreenshot.filter((value) => exact.has(value));
  return {
    screenshotTextCount: normalizedScreenshot.length,
    presentInDataCount: presentInData.length,
    missingFromDataCount: missingFromData.length,
    complete: missingFromData.length === 0,
    presentInData,
    missingFromData,
  };
}

export function implementationContract(spec) {
  return (spec.nodes ?? []).map((root) => {
    const primary = (root.children ?? []).filter(isNodeVisible).map(contractChild);
    const secondary = (root.children ?? []).filter(isNodeVisible).flatMap((child) =>
      (child.children ?? []).filter(isNodeVisible).map(contractChild));
    const textStyles = [];
    const seenText = new Set();
    walkVisibleNodes([root], (node) => {
      if (!node.text?.value) return true;
      const key = JSON.stringify([
        node.text.fontFamily,
        node.text.fontWeight,
        node.text.fontSize,
        node.text.lineHeightPx,
        node.text.letterSpacing,
        node.fills,
      ]);
      if (!seenText.has(key) && textStyles.length < 12) {
        seenText.add(key);
        textStyles.push({
          example: node.text.value.replace(/\s+/g, " ").slice(0, 80),
          ...compactStyleContract(node),
        });
      }
      return true;
    });
    return {
      id: root.id,
      name: root.name,
      root: compactStyleContract(root),
      primary,
      secondary,
      textStyles,
    };
  });
}

export function summaryMarkdown(spec, artifacts = {}) {
  const stats = visibleNodeStats(spec);
  const roots = spec.nodes.map((node) => `\`${node.name}\` (${node.type}, ${node.id})`).join(", ");
  return `# Figma inspection\n\n- File: ${spec.source.fileName ?? spec.source.fileKey}\n- Selected: ${roots || "file root"}\n- Version: ${spec.source.version ?? "unknown"}\n- Last modified: ${spec.source.lastModified ?? "unknown"}\n- Visible nodes: ${stats.total}\n- Visible text nodes: ${stats.text}\n- Visible image fills: ${stats.images}\n${artifacts.screenshots?.length ? `- Screenshots: ${artifacts.screenshots.map((path) => `\`${path}\``).join(", ")}\n` : ""}${artifacts.evidence ? `- Visible evidence: \`${artifacts.evidence}\`\n` : ""}\n> Fidelity lock: this tree omits hidden subtrees. Use visible evidence plus the selected-state screenshot; never substitute hidden variant copy or invent product data.\n\n## Visible layer tree\n\n${specTree(spec, { maxDepth: 6, maxNodes: 250, visibleOnly: true })}\n`;
}
