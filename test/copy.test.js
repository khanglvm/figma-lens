import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkImplementationCopy } from "../src/copy.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "figma-lens-copy-"));
  const evidence = join(directory, "visible-evidence.json");
  await writeFile(evidence, JSON.stringify({
    states: [{ visibleText: [
      { id: "1:1", value: "Create Project" },
      { id: "1:2", value: "24 templates" },
      { id: "1:3", value: "Cancel" },
    ] }],
  }));
  return { directory, evidence };
}

test("copy gate rejects invented visible product data", async () => {
  const { directory, evidence } = await fixture();
  const source = join(directory, "Modal.jsx");
  await writeFile(source, `
    import React from "react";
    const people = ['Invented Alpha', 'Invented Beta'];
    export function Modal() {
      return <div className="modal"><h1>Create Project</h1><p>{people[0]}</p><small>Unproven category · {5} items</small><button>Cancel immediately today</button></div>;
    }
  `);

  const result = await checkImplementationCopy(evidence, [source]);
  assert.equal(result.ok, false);
  assert.equal(result.violationCount, 5);
  assert.deepEqual(result.violations.map((item) => item.value), [
    "Unproven category ·",
    "Cancel immediately today",
    "items",
    "Invented Alpha",
    "Invented Beta",
  ]);
});

test("copy gate accepts evidence fragments and attested screenshot-only copy", async () => {
  const { directory, evidence } = await fixture();
  const source = join(directory, "Modal.tsx");
  await writeFile(source, `
    export function Modal() {
      return <><h1>Create Project</h1><strong>24</strong> templates<button>Cancel</button><label>Smart template</label></>;
    }
  `);

  const result = await checkImplementationCopy(evidence, [source], { allow: ["Smart template"] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("copy gate accepts a single-state focus-set evidence artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "figma-lens-copy-state-"));
  const evidence = join(directory, "visible-evidence-state.json");
  const source = join(directory, "Modal.jsx");
  await writeFile(evidence, JSON.stringify({ state: { visibleText: [{ value: "Cancel" }] } }));
  await writeFile(source, "export const Modal = () => <button>Cancel</button>;");
  assert.equal((await checkImplementationCopy(evidence, [source])).ok, true);
});

test("copy gate merges exact visible copy from bounded detail evidence", async () => {
  const { directory, evidence } = await fixture();
  const detailEvidence = join(directory, "detail-evidence.json");
  const source = join(directory, "Modal.jsx");
  await writeFile(detailEvidence, JSON.stringify({ states: [{ visibleText: [{ value: "Smart template" }] }] }));
  await writeFile(source, "export const Modal = () => <button>Smart template</button>;");
  const result = await checkImplementationCopy(evidence, [source], { evidencePaths: [detailEvidence] });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.length, 2);
});
