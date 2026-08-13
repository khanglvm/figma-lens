import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNodeId, parseFigmaRef, parseNodeIds } from "../src/ref.js";

test("parses a Figma node URL and normalizes the URL node ID", () => {
  const ref = parseFigmaRef(
    "https://www.figma.com/design/AbCdEf123456/Synthetic?node-id=12-34&m=dev",
  );
  assert.equal(ref.fileKey, "AbCdEf123456");
  assert.deepEqual(ref.nodeIds, ["12:34"]);
});

test("accepts file keys and explicit batched node IDs", () => {
  const ref = parseFigmaRef("AbC123", "1:2,3-4,1:2");
  assert.deepEqual(ref.nodeIds, ["1:2", "3:4"]);
});

test("normalizes nested instance paths without weakening validation", () => {
  assert.equal(normalizeNodeId("I5666-180910;1-10515"), "I5666:180910;1:10515");
  assert.throws(() => parseNodeIds("../../secret"), /Invalid Figma node ID/);
});

test("rejects non-Figma URLs", () => {
  assert.throws(() => parseFigmaRef("https://example.com/design/abc/File?node-id=1-2"), /Not a figma.com URL/);
});
