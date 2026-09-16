import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addTeam,
  discoveryContext,
  findDesigns,
  parseTeamId,
  readDiscoveryConfig,
  removeTeam,
} from "../src/discovery.js";

function rawFile(name, frameName, copy, lastModified = "2026-09-16T00:00:00Z") {
  return {
    name,
    lastModified,
    version: "1",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Main page",
        type: "CANVAS",
        children: [{
          id: "1:1",
          name: frameName,
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
          children: [{
            id: "1:2",
            name: "Visible message",
            type: "TEXT",
            characters: copy,
            absoluteBoundingBox: { x: 40, y: 40, width: 500, height: 40 },
          }],
        }],
      }],
      components: {},
      styles: {},
    },
    components: {},
    styles: {},
  };
}

class FakeDiscoveryApi {
  constructor() {
    this.calls = [];
    this.files = {
      CandidateFile: rawFile("Recruitment workspace", "Candidate filters - No results", "No matching candidates"),
      BillingFile: rawFile("Finance workspace", "Invoice payment details", "Pay outstanding invoice"),
    };
  }

  record(path) {
    this.calls.push({ path, status: 200, attempt: 1 });
  }

  async me() {
    this.record("v1/me");
    return { data: { id: "7", handle: "designer" } };
  }

  async getTeamFolders(teamId) {
    this.record(`v2/teams/${teamId}/folders`);
    return { data: { name: "Product Design", folders: [{ id: "folder-1", name: "Recruitment", parent_folder_id: null }] } };
  }

  async getFolderFolders(folderId) {
    this.record(`v2/folders/${folderId}/folders`);
    return { data: { name: "Recruitment", folders: [] } };
  }

  async getFolderFiles(folderId) {
    this.record(`v2/folders/${folderId}/files`);
    return {
      data: {
        name: "Recruitment",
        files: [
          { key: "CandidateFile", name: "Recruitment workspace", last_modified: "2026-09-16T00:00:00Z" },
          { key: "BillingFile", name: "Finance workspace", last_modified: "2026-09-15T00:00:00Z" },
        ],
      },
    };
  }

  async getFile(fileKey, { depth } = {}) {
    this.record(`v1/files/${fileKey}?depth=${depth}`);
    return { data: this.files[fileKey] };
  }

  async getFileMeta(fileKey) {
    this.record(`v1/files/${fileKey}/meta`);
    return {
      data: {
        file: {
          name: this.files[fileKey]?.name ?? "Candidate journeys",
          folder_name: "Recruitment",
        },
      },
    };
  }
}

test("parses team IDs from current Figma team URLs", () => {
  assert.equal(parseTeamId("1535685101263221741"), "1535685101263221741");
  assert.equal(
    parseTeamId("https://www.figma.com/files/181033233908053158/team/1535685101263221741/Product"),
    "1535685101263221741",
  );
  assert.throws(() => parseTeamId("https://www.figma.com/design/File/Screen"), /team ID/);
});

test("registers searchable teams privately and exposes compact account context", async () => {
  const root = await mkdtemp(join(tmpdir(), "figma-lens-discovery-config-"));
  const env = { FIGMA_LENS_CONFIG_DIR: root };
  const api = new FakeDiscoveryApi();
  const added = await addTeam(api, "123", { env });
  assert.equal(added.team.name, "Product Design");
  assert.equal((await stat(added.path)).mode & 0o777, 0o600);
  assert.deepEqual((await readDiscoveryConfig({ env })).teams.map((team) => team.id), ["123"]);

  await writeFile(join(root, "credentials.json"), JSON.stringify({ figmaToken: "secret", account: { id: "7", handle: "designer" } }));
  const context = await discoveryContext(api, { env });
  assert.deepEqual(context.account, { id: "7", handle: "designer" });
  assert.deepEqual(context.teams.map((team) => team.name), ["Product Design"]);
  assert.equal(context.setup.required, false);

  const removed = await removeTeam("123", { env });
  assert.equal(removed.removed, true);
  assert.deepEqual((await readDiscoveryConfig({ env })).teams, []);
});

test("turns a design URL into a tailored request for the owning team URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "figma-lens-team-guide-"));
  const env = { FIGMA_LENS_CONFIG_DIR: root };
  const api = new FakeDiscoveryApi();
  const guided = await addTeam(
    api,
    "https://www.figma.com/design/CandidateFile/Journeys?node-id=1-1",
    { env },
  );
  assert.equal(guided.ok, false);
  assert.equal(guided.status, "needs_team_url");
  assert.equal(guided.source.fileName, "Recruitment workspace");
  assert.equal(guided.source.folderName, "Recruitment");
  assert.match(guided.request, /team containing the "Recruitment" folder/);
  assert.match(guided.request, /\/team\/<number>\//);
  assert.match(guided.request, /Do not share a Figma token/);
  assert.deepEqual((await readDiscoveryConfig({ env })).teams, []);

  const context = await discoveryContext(api, {
    env,
    sourceUrl: "https://www.figma.com/design/CandidateFile/Journeys?node-id=1-1",
  });
  assert.equal(context.setup.status, "needs_team_url");
  assert.equal(context.setup.source.folderName, "Recruitment");

  const generic = await addTeam(api, undefined, { env });
  assert.equal(generic.status, "needs_team_url");
  assert.match(generic.request, /files you want searched/);
});

test("finds a fuzzy design match across registered team files with bounded output", async () => {
  const root = await mkdtemp(join(tmpdir(), "figma-lens-discovery-find-"));
  const env = { FIGMA_LENS_CONFIG_DIR: root };
  const output = join(root, "index");
  const firstApi = new FakeDiscoveryApi();
  await addTeam(firstApi, "123", { env });
  firstApi.calls.length = 0;

  const first = await findDesigns(firstApi, "recruiter filters candidates and sees no results", {
    env,
    output,
    scope: "product design recruitment",
    maxFiles: 2,
    render: 0,
  });
  assert.equal(first.ok, true);
  assert.equal(first.status, "complete");
  assert.equal(first.matches[0].file.key, "CandidateFile");
  assert.equal(first.matches[0].node.name, "Candidate filters - No results");
  assert.match(first.matches[0].preview, /No matching candidates/);
  assert.equal(first.coverage.discoveredFiles, 2);
  assert.equal(first.coverage.fetchedFiles, 2);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 6_000);
  assert.ok(firstApi.calls.some((call) => call.path.includes("v1/files/CandidateFile")));

  const secondApi = new FakeDiscoveryApi();
  const second = await findDesigns(secondApi, "candidate no matching results", {
    env,
    output,
    scope: "Recruitment",
    maxFiles: 2,
    render: 0,
  });
  assert.equal(second.matches[0].file.key, "CandidateFile");
  assert.equal(second.coverage.cachedFiles, 2);
  assert.equal(second.coverage.fetchedFiles, 0);
  assert.equal(secondApi.calls.length, 0);
});

test("reports bounded partial coverage and actionable setup gaps", async () => {
  const root = await mkdtemp(join(tmpdir(), "figma-lens-discovery-partial-"));
  const env = { FIGMA_LENS_CONFIG_DIR: root };
  const missing = await findDesigns(new FakeDiscoveryApi(), "candidate screen", { env, render: 0 });
  assert.equal(missing.status, "needs_setup");
  assert.match(missing.setup.next.command, /teams add/);
  assert.match(missing.setup.request, /paste the full team-page URL/);

  const api = new FakeDiscoveryApi();
  await addTeam(api, "123", { env });
  api.calls.length = 0;
  const partial = await findDesigns(api, "candidate screen", {
    env,
    output: join(root, "partial-index"),
    maxFiles: 1,
    render: 0,
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.coverage.fetchedFiles, 1);
  assert.equal(partial.coverage.skippedFiles, 1);
});
