import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createSessionRouterTools, routingMessagesFromJsonl } = await jiti.import("./session-router-tools.ts");
const { startsOnSessionRouter } = await jiti.import("./session-routing.ts");

function fixture(signal) {
  let reads = 0;
  const sessions = Array.from({ length: 35 }, (_, i) => ({ id: `s${i}`, path: `/only/catalog/${i}`, cwd: i ? "/piano" : "/pi-web",
    name: i ? `Piano ${i}` : "Composer improvements", firstMessage: "task", created: "", modified: "", messageCount: 2 }));
  const router = createSessionRouterTools({ sessions, read: async () => { reads++; return { messages: [{ role: "user", text: "context" }], hasMore: false }; } }, signal);
  const call = (name, args = {}) => router.tools.find(t => t.name === name).execute("test-call", args);
  return { ...router, call, reads: () => reads };
}

test("bare homepage uses routing, explicit session/cwd URLs retain normal navigation", () => {
  for (const query of ["", "sidebar=collapsed"]) assert.equal(startsOnSessionRouter(new URLSearchParams(query)), true);
  for (const query of ["session=s0", "cwd=/project", "session=s0&cwd=/p"]) assert.equal(startsOnSessionRouter(new URLSearchParams(query)), false);
});

test("router exposes exactly the three tools and catalog search/pagination is bounded", async () => {
  const f = fixture();
  assert.deepEqual(f.tools.map(t => t.name), ["list_sessions", "read_session", "open_session"]);
  const all = JSON.parse((await f.call("list_sessions")).content[0].text);
  assert.equal(all.sessions.length, 30); assert.equal(all.nextOffset, 30);
  const page = JSON.parse((await f.call("list_sessions", { offset: 30 })).content[0].text);
  assert.equal(page.sessions.length, 5); assert.equal(page.nextOffset, null);
  const match = JSON.parse((await f.call("list_sessions", { query: "PI-WEB" })).content[0].text);
  assert.equal(match.sessions.length, 1); assert.equal(match.sessions[0].id, "s0");
});

test("unknown IDs and paths cannot be read, and unread targets cannot be selected", async () => {
  const f = fixture();
  await assert.rejects(f.call("read_session", { sessionId: "/etc/passwd" }), /Unknown session/);
  await assert.rejects(f.call("open_session", { sessionId: "s0", reason: "guess" }), /Read the target/);
  assert.equal(f.reads(), 0); assert.equal(f.getSelection(), undefined);
});

test("only a reviewed target can be selected once; selection does not execute or send tasks", async () => {
  const f = fixture();
  await f.call("read_session", { sessionId: "s0" });
  const result = await f.call("open_session", { sessionId: "s0", reason: "Same composer project" });
  assert.equal(result.terminate, true); assert.equal(f.getSelection().target.id, "s0");
  assert.equal(f.reads(), 1);
  assert.deepEqual(f.getCandidates().map(s => s.id), ["s0"]);
  await assert.rejects(f.call("open_session", { sessionId: "s1", reason: "second" }), /already been selected/);
});

test("cancellation and tool-call budget stop further catalog access", async () => {
  const abort = new AbortController(); const f = fixture(abort.signal); abort.abort();
  await assert.rejects(f.call("read_session", { sessionId: "s0" })); assert.equal(f.reads(), 0);
  const bounded = fixture(); for (let i = 0; i < 24; i++) await bounded.call("list_sessions");
  await assert.rejects(bounded.call("list_sessions"), /budget/);
});

test("context reader follows the active branch and omits tools, thinking, signatures and images", () => {
  const entries = [
    { type: "session", id: "session", cwd: "/p" },
    { type: "message", id: "u", parentId: null, message: { role: "user", content: "Improve composer" } },
    { type: "message", id: "abandoned", parentId: "u", message: { role: "assistant", content: "Wrong branch" } },
    { type: "compaction", id: "summary", parentId: "u", summary: "Composer history" },
    { type: "message", id: "tool", parentId: "summary", message: { role: "toolResult", content: [{ type: "text", text: "SECRET" }] } },
    { type: "message", id: "a", parentId: "tool", message: { role: "assistant", content: [
      { type: "thinking", thinking: "PRIVATE" }, { type: "image", data: "BINARY" }, { type: "text", text: "Done", textSignature: "SIGNATURE" },
    ] } },
  ];
  const result = routingMessagesFromJsonl(entries.map(e => JSON.stringify(e)).join("\n") + '\n{"unfinished":');
  assert.deepEqual(result.messages, [{ role: "user", text: "Improve composer" }, { role: "summary", text: "Composer history" }, { role: "assistant", text: "Done" }]);
  assert.equal(result.hasMore, false);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE|BINARY|SIGNATURE|Wrong branch/);
});

test("context preview is bounded and can page into older user messages", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ type: "message", id: `m${i}`, parentId: i ? `m${i-1}` : null,
    message: { role: "user", content: `${i}:` + "a".repeat(3000) } }));
  const jsonl = rows.map(e => JSON.stringify(e)).join("\n");
  const page = routingMessagesFromJsonl(jsonl);
  assert.equal(page.messages.length, 12); assert.equal(page.hasMore, true);
  assert.ok(page.messages.every(m => m.text.length <= 2000));
  const older = routingMessagesFromJsonl(jsonl, 12); assert.equal(older.messages.length, 3); assert.equal(older.hasMore, false);
});
