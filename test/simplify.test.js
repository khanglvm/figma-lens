import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceCoverage,
  imageRefsFromRaw,
  implementationContract,
  nodeStats,
  searchSpec,
  simplifyResponse,
  specTree,
  summaryMarkdown,
  typographyCatalog,
  visibleEvidence,
} from "../src/simplify.js";
import { rawFixture } from "../fixtures/raw.js";

const ref = { fileKey: "AbC123", nodeIds: ["1:2"] };

test("produces compact implementation data and relative child geometry", () => {
  const spec = simplifyResponse(rawFixture, ref);
  assert.equal(spec.nodes[0].layout.mode, "VERTICAL");
  assert.equal(spec.nodes[0].fills[0].color, "#ffffff");
  assert.equal(spec.nodes[0].children[0].bounds.relativeX, 24);
  assert.equal(spec.nodes[0].children[0].text.value, "Payment details");
  assert.deepEqual(nodeStats(spec), {
    total: 3,
    text: 1,
    images: 1,
    byType: { FRAME: 1, TEXT: 1, RECTANGLE: 1 },
  });
});

test("searches cached names and text without API semantics", () => {
  const spec = simplifyResponse(rawFixture, ref);
  const matches = searchSpec(spec, "payment details");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "1:3");
  assert.match(specTree(spec), /Card artwork \[RECTANGLE 1:4\]/);
});

test("extracts source image references from selected raw subtrees", () => {
  assert.deepEqual(imageRefsFromRaw(rawFixture), ["image-ref-123"]);
});

test("preserves explicit false visibility while keeping paint opacity separate", () => {
  const hidden = structuredClone(rawFixture);
  hidden.nodes["1:2"].document.visible = false;
  hidden.nodes["1:2"].document.fills[0].opacity = 0.5;
  const node = simplifyResponse(hidden, ref).nodes[0];
  assert.equal(node.visible, false);
  assert.equal(node.fills[0].color, "#ffffff");
  assert.equal(node.fills[0].opacity, 0.5);
});

test("keeps selected component values without copying large preferred-value catalogs", () => {
  const withComponent = structuredClone(rawFixture);
  const node = withComponent.nodes["1:2"].document;
  node.componentId = "9:9";
  node.componentProperties = {
    "Left icon": {
      type: "INSTANCE_SWAP",
      value: "8:8",
      preferredValues: Array.from({ length: 1_000 }, (_, index) => ({ type: "COMPONENT", key: `icon-${index}` })),
    },
    State: { type: "VARIANT", value: "Default" },
  };
  withComponent.nodes["1:2"].components = { "9:9": { name: "Button" } };

  const component = simplifyResponse(withComponent, ref).nodes[0].component;
  assert.equal(component.name, "Button");
  assert.deepEqual(component.properties["Left icon"], {
    type: "INSTANCE_SWAP",
    value: "8:8",
    preferredValueCount: 1_000,
  });
  assert.ok(JSON.stringify(component).length < 250);
});

test("visible evidence and implementation artifacts exclude hidden and zero-opacity subtrees", () => {
  const withDormantVariants = structuredClone(rawFixture);
  withDormantVariants.nodes["1:2"].document.children.push(
    {
      id: "1:5",
      name: "Hidden variant",
      type: "FRAME",
      visible: false,
      children: [{
        id: "1:6",
        name: "Hidden label",
        type: "TEXT",
        characters: "Invented AI assistant",
      }],
    },
    {
      id: "1:7",
      name: "Transparent variant",
      type: "FRAME",
      opacity: 0,
      children: [{
        id: "1:8",
        name: "Transparent label",
        type: "TEXT",
        characters: "Invented candidate count",
      }],
    },
  );
  const spec = simplifyResponse(withDormantVariants, ref);
  const evidence = visibleEvidence(spec, { screenshots: ["state.png"] });
  const contract = implementationContract(spec)[0];

  assert.deepEqual(evidence.states[0].visibleText.map((node) => node.value), ["Payment details"]);
  assert.equal(evidence.states[0].hiddenSubtrees, 2);
  assert.equal(evidence.states[0].hiddenNodes, 4);
  assert.equal(evidence.states[0].screenshot, "state.png");
  assert.deepEqual(evidence.states[0].visibleText[0], {
    id: "1:3",
    value: "Payment details",
    typographyRef: "t1",
    at: "24,24 180x24",
  });
  assert.deepEqual(evidence.states[0].typography.styles[0], {
    id: "t1",
    fontFamily: "Inter",
    fontWeight: 600,
    fontSize: 18,
    lineHeightPx: 24,
    fills: [{ type: "SOLID", color: "#1a1a1a" }],
    usageCount: 1,
    examples: [{ id: "1:3", text: "Payment details" }],
  });
  assert.equal(evidence.states[0].coverage.status, "bounded-unknown");
  assert.equal(contract.primary.some((node) => node.id === "1:5" || node.id === "1:7"), false);
  assert.equal(searchSpec(spec, "Invented").length, 0);
  assert.doesNotMatch(specTree(spec, { visibleOnly: true }), /Hidden label|Transparent label/);
  assert.deepEqual(evidenceCoverage(spec, ["Payment details", "Visible only in screenshot"]), {
    screenshotTextCount: 2,
    presentInDataCount: 1,
    missingFromDataCount: 1,
    complete: false,
    presentInData: ["Payment details"],
    missingFromData: ["Visible only in screenshot"],
  });
});

test("surfaces exact font faces, metrics, and decoded mixed-style runs", () => {
  const mixed = structuredClone(rawFixture);
  const title = mixed.nodes["1:2"].document.children[0];
  title.style = {
    ...title.style,
    fontPostScriptName: "Inter-Regular",
    fontStyle: "Regular",
    letterSpacing: -0.25,
  };
  title.characters = "Payment details";
  title.characterStyleOverrides = [0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2];
  title.styleOverrideTable = {
    2: {
      fontFamily: "Inter",
      fontPostScriptName: "Inter-SemiBold",
      fontStyle: "Semi Bold",
      fontWeight: 600,
      fontSize: 18,
      lineHeightPx: 24,
      letterSpacing: -0.25,
    },
  };

  const spec = simplifyResponse(mixed, ref);
  const text = spec.nodes[0].children[0].text;
  assert.equal(text.fontPostScriptName, "Inter-Regular");
  assert.equal(text.fontStyle, "Regular");
  assert.deepEqual(text.mixedStyleRuns, [{
    start: 8,
    end: 15,
    text: "details",
    style: {
      fontFamily: "Inter",
      fontPostScriptName: "Inter-SemiBold",
      fontStyle: "Semi Bold",
      fontWeight: 600,
      fontSize: 18,
      lineHeightPx: 24,
      letterSpacing: -0.25,
    },
  }]);

  const typography = typographyCatalog(spec);
  assert.equal(typography.visibleTextNodes, 1);
  assert.equal(typography.mixedStyleNodes, 1);
  assert.deepEqual(typography.fontFaces.map((face) => face.postScriptName).sort(), [
    "Inter-Regular",
    "Inter-SemiBold",
  ]);
  assert.equal(typography.styles[0].fontFamily, "Inter");
  assert.equal(typography.availability.status, "not-verified");
  assert.match(summaryMarkdown(spec), /## Typography/);
  assert.match(summaryMarkdown(spec), /Inter-Regular/);
  assert.match(summaryMarkdown(spec), /Font availability is not verified/);
});
