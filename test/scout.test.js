import assert from "node:assert/strict";
import test from "node:test";
import { flowWrapperRawFixture, scoutRawFixture } from "../fixtures/scout.js";
import { simplifyResponse } from "../src/simplify.js";
import { buildCandidateIndex, findSpecNode, normalizeSearchText, scoutCandidates } from "../src/scout.js";

const ref = { fileKey: "Scout123", nodeIds: ["10:1"] };
const spec = simplifyResponse(scoutRawFixture, ref);

test("normalizes Unicode text for accent-insensitive discovery", () => {
  assert.equal(normalizeSearchText("Criação Rápida"), "criacao rapida");
});

test("builds a compact candidate catalog from screen and component containers", () => {
  const candidates = buildCandidateIndex(spec);
  assert.deepEqual(candidates.map((candidate) => candidate.id).sort(), ["10:2", "10:3", "10:31", "10:4"]);
  assert.equal(candidates.find((candidate) => candidate.id === "10:3").descendantCount, 4);
});

test("ranks a matching screen from a natural-language intent", () => {
  const result = scoutCandidates(spec, "implement the screen where a user creates a project with a smart template", { limit: 3 });
  assert.equal(result.mode, "intent-match");
  assert.equal(result.candidates[0].id, "10:3");
  assert.equal(result.candidates[0].confidence, "high");
  assert.ok(result.candidates[0].coverage >= 0.75);
});

test("uses wrapper context and initial-state aliases for implementation intent", () => {
  const initialRaw = structuredClone(scoutRawFixture);
  initialRaw.nodes["10:1"].document.name = "Create project";
  initialRaw.nodes["10:1"].document.children[0].name = "Empty / Start";
  const initialSpec = simplifyResponse(initialRaw, ref);
  const result = scoutCandidates(initialSpec, "initial Create Project screen", { limit: 3 });

  assert.equal(result.candidates[0].id, "10:2");
  assert.equal(result.candidates[0].confidence, "high");
  assert.equal(result.candidates[0].coverage, 1);
});

test("ranks import flow keywords and supports focused extraction", () => {
  const result = scoutCandidates(spec, "import tasks from an Excel spreadsheet", { limit: 3 });
  assert.equal(result.candidates[0].id, "10:4");
  assert.equal(findSpecNode(spec, "10:31").name, "Smart template option");
});

test("falls back to likely screen containers when words do not match", () => {
  const result = scoutCandidates(spec, "quantum banana", { limit: 2 });
  assert.equal(result.mode, "structural-fallback");
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].confidence, "low");
});

test("catalog mode ranks implementable screens ahead of flow annotations", () => {
  const wrapperSpec = simplifyResponse(flowWrapperRawFixture, { fileKey: "Flow123", nodeIds: ["18:1"] });
  const result = scoutCandidates(wrapperSpec, "", { limit: 4 });

  assert.deepEqual(result.candidates.slice(0, 3).map((candidate) => candidate.id), ["18:6", "18:5", "18:7"]);
  assert.ok(result.candidates.every((candidate) => candidate.kind !== "annotation"));
  assert.deepEqual(result.context.map((item) => item.label), ["Editor/Viewer", "HOVER"]);
  assert.equal(result.topLevelKindCounts.annotation, 4);
  assert.equal(result.topLevelKindCounts.screen, 2);
  assert.equal(result.topLevelKindCounts.dialog, 1);
  assert.equal(result.topLevelKindCounts.element, 1);
  assert.deepEqual(result.states.map((state) => state.id), ["18:5", "18:9", "18:6", "18:7"]);
});

test("catalog identifies one repeated modal as a stateful component and exposes inner implementation nodes", () => {
  const fixture = structuredClone(scoutRawFixture);
  const root = fixture.nodes["10:1"].document;
  root.children = ["Empty / Start", "Loading", "Results Ready", "No Matching Items"].map((name, index) => ({
    id: `20:${index + 1}`,
    name,
    type: "FRAME",
    absoluteBoundingBox: { x: index * 1500, y: 0, width: 1440, height: 1024 },
    children: [{
      id: `21:${index + 1}`,
      name: "ModalCard",
      type: "FRAME",
      absoluteBoundingBox: { x: index * 1500 + 120, y: 80, width: 1200, height: 864 },
      children: [],
    }],
  }));
  root.absoluteBoundingBox = { x: 0, y: 0, width: 5940, height: 1024 };
  const spec = simplifyResponse(fixture, { fileKey: "Scout123", nodeIds: ["10:1"] });
  const result = scoutCandidates(spec, "", { limit: 5 });

  assert.equal(result.collection.kind, "stateful-component");
  assert.deepEqual(result.collection.representativeStates.map((state) => state.name), [
    "Empty / Start",
    "Loading",
    "Results Ready",
    "No Matching Items",
  ]);
  assert.deepEqual(result.states.map((state) => state.implementationId), ["21:1", "21:2", "21:3", "21:4"]);
});

test("intent mode finds a named state without promoting matching flow chrome", () => {
  const wrapperSpec = simplifyResponse(flowWrapperRawFixture, { fileKey: "Flow123", nodeIds: ["18:1"] });
  const result = scoutCandidates(wrapperSpec, "document details denied access", { limit: 3 });

  assert.equal(result.candidates[0].id, "18:5");
  assert.equal(result.candidates[0].kind, "screen");
  assert.equal(result.candidates[0].confidence, "high");
  assert.ok(!result.candidates.some((candidate) => candidate.id === "18:50"));
});

test("uses a matched board annotation to rank nearby design states", () => {
  const wrapperSpec = simplifyResponse(flowWrapperRawFixture, { fileKey: "Flow123", nodeIds: ["18:1"] });
  const result = scoutCandidates(wrapperSpec, "hover locked document title", { limit: 3 });

  assert.equal(result.mode, "spatial-context");
  assert.equal(result.matchedContext[0].id, "18:8");
  assert.deepEqual(result.candidates.slice(0, 2).map((candidate) => candidate.id), ["18:6", "18:9"]);
  assert.match(result.candidates[0].why[0], /near matched annotation/);
});
