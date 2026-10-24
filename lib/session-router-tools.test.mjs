import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createSessionRouterTools, routingMessagesFromJsonl, searchRoutingMessages } = await jiti.import("./session-router-tools.ts");
const { startsOnSessionRouter } = await jiti.import("./session-routing.ts");

function fixture(signal) {
  let reads = 0;
  const searches = [];
  const sessions = Array.from({ length: 35 }, (_, i) => ({ id: `s${i}`, path: `/only/catalog/${i}`, cwd: i ? "/piano" : "/pi-web",
    name: i ? `Piano ${i}` : "Composer improvements", firstMessage: "task", created: "", modified: "", messageCount: 2 }));
  const router = createSessionRouterTools({ sessions,
    read: async session => { reads++; return { messages: [{ role: "user", text: "User asks for a composer feature." }, { role: "assistant", text: session.id === "s0" ? "Implemented the relevant composer feature." : "Implemented piano practice." }], hasMore: false }; },
    search: async (session, query, match) => {
      searches.push({ id: session.id, query, match });
      return searchRoutingMessages(JSON.stringify({ type: "message", id: "a", parentId: null,
        message: { role: "assistant", content: session.id === "s0" ? "Implemented the relevant composer feature." : "Implemented piano practice." } }), query, match);
    },
  }, signal);
  const call = (name, args = {}) => router.tools.find(t => t.name === name).execute("test-call", args);
  return { ...router, call, reads: () => reads, searches: () => searches };
}

test("bare homepage uses routing, explicit session/cwd URLs retain normal navigation", () => {
  for (const query of ["", "sidebar=collapsed"]) assert.equal(startsOnSessionRouter(new URLSearchParams(query)), true);
  for (const query of ["session=s0", "cwd=/project", "session=s0&cwd=/p"]) assert.equal(startsOnSessionRouter(new URLSearchParams(query)), false);
});

test("router exposes four read-only tools and catalog search/pagination is bounded", async () => {
  const f = fixture();
  assert.deepEqual(f.tools.map(t => t.name), ["list_sessions", "search_sessions", "read_session", "open_session"]);
  const all = JSON.parse((await f.call("list_sessions")).content[0].text);
  assert.equal(all.sessions.length, 30); assert.equal(all.nextOffset, null);
  assert.equal(all.scope, "recent"); assert.equal(all.order, "modified_desc"); assert.equal(all.olderAvailable, true);
  const page = JSON.parse((await f.call("list_sessions", { offset: 30, includeOlder: true })).content[0].text);
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
  await f.call("list_sessions");
  await f.call("read_session", { sessionId: "s0" });
  await assert.rejects(f.call("open_session", { sessionId: "s0", reason: "Same composer project" }), /Search historical message bodies/);
  await f.call("search_sessions", { query: "composer" });
  await assert.rejects(f.call("open_session", { sessionId: "s0", reason: "guess", evidence: "Invented implementation evidence" }), /verbatim quote/);
  const result = await f.call("open_session", { sessionId: "s0", reason: "Same composer project", evidence: "Implemented the relevant composer feature." });
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

test("the first call always shows the latest 30 in descending time, without mutating the catalog", async () => {
  const sessions = Array.from({ length: 35 }, (_, i) => ({ id: `id-${i}`, path: `/fixture/${i}`, cwd: "/p",
    name: i === 0 ? "Legacy migration" : "Recent work", firstMessage: "", created: "2026-01-01",
    modified: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), messageCount: 1 })).reverse();
  // Ensure input order is neither ascending nor descending.
  [sessions[0], sessions[20]] = [sessions[20], sessions[0]];
  const before = sessions.map(s => s.id);
  const router = createSessionRouterTools({ sessions,
    read: async () => ({ messages: [{ role: "assistant", text: "Legacy migration implemented successfully." }], hasMore: false }),
    search: async (session, query, match) => searchRoutingMessages(JSON.stringify({ type: "message", id: "a", parentId: null,
      message: { role: "assistant", content: session.name } }), query, match),
  });
  const call = (name, args = {}) => router.tools.find(t => t.name === name).execute("test", args);
  const initial = JSON.parse((await call("list_sessions", { query: "Legacy", offset: 30, includeOlder: true })).content[0].text);
  assert.equal(initial.scope, "recent"); assert.equal(initial.firstWindow, true); assert.equal(initial.sessions.length, 30);
  assert.deepEqual(initial.sessions.map(s => s.id), Array.from({ length: 30 }, (_, i) => `id-${34-i}`));
  assert.deepEqual(sessions.map(s => s.id), before);
  assert.equal(JSON.parse((await call("list_sessions", { query: "Legacy" })).content[0].text).sessions.length, 0);
  await assert.rejects(call("read_session", { sessionId: "id-0" }), /include older/);
  const older = JSON.parse((await call("list_sessions", { query: "Legacy", includeOlder: true })).content[0].text);
  assert.equal(older.scope, "all"); assert.equal(older.sessions[0].id, "id-0");
  await call("read_session", { sessionId: "id-0" });
  await call("search_sessions", { query: "Legacy", includeOlder: true });
  await call("open_session", { sessionId: "id-0", reason: "No recent match; legacy task", evidence: "Legacy migration implemented successfully." });
  assert.equal(router.getSelection().target.id, "id-0");
});

test("ambiguous candidates are newest-first even when read in the opposite order", async () => {
  const sessions = [{ id: "old", modified: "2026-01-01" }, { id: "new", modified: "2026-01-03" }, { id: "bad-date", modified: "invalid" }]
    .map(s => ({ ...s, path: "/fixture", cwd: "/p", firstMessage: "", created: "", messageCount: 1 }));
  const router = createSessionRouterTools({ sessions, read: async () => ({ messages: [], hasMore: false }) });
  const call = (name, args = {}) => router.tools.find(t => t.name === name).execute("test", args);
  await call("list_sessions");
  for (const session of sessions) await call("read_session", { sessionId: session.id });
  assert.deepEqual(router.getCandidates().map(s => s.id), ["new", "old", "bad-date"]);
});

test("body search runs only when the Agent explicitly calls it, with the Agent's query", async () => {
  const f = fixture();
  assert.equal(f.searches().length, 0);
  await assert.rejects(f.call("search_sessions", { query: "composer" }), /list_sessions first/);
  await f.call("list_sessions"); assert.equal(f.searches().length, 0);
  const results = JSON.parse((await f.call("search_sessions", { query: "composer", match: "all" })).content[0].text);
  assert.equal(f.searches().length, 30); assert.ok(f.searches().every(call => call.query === "composer" && call.match === "all"));
  assert.equal(results.sessions.length, 1); assert.equal(results.sessions[0].id, "s0");
  assert.equal(results.sessions[0].hits[0].role, "assistant");
});

test("selection cannot contradict the latest search or cite a repeated user request as evidence", async () => {
  const f = fixture(); await f.call("list_sessions"); await f.call("read_session", { sessionId: "s0" });
  await f.call("search_sessions", { query: "piano" });
  await assert.rejects(f.call("open_session", { sessionId: "s0", reason: "earlier guess", evidence: "Implemented the relevant composer feature." }), /latest body-search/);
  await f.call("search_sessions", { query: "composer" });
  await assert.rejects(f.call("open_session", { sessionId: "s0", reason: "same question", evidence: "User asks for a composer feature." }), /assistant\/summary/);
  assert.equal(f.getSelection(), undefined);
});

test("full-body search finds older context beyond the 12-message and 2000-character preview", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ type: "message", id: `message-${i}`, parentId: i ? `message-${i-1}` : null,
    timestamp: "2026-10-01T00:00:00Z", message: { role: "assistant", content: i ? "unrelated update" : "a".repeat(3000) + " Deployed SPECIAL-BODY-TOKEN /feature/ successfully." } }));
  const jsonl = rows.map(e => JSON.stringify(e)).join("\n");
  assert.ok(!JSON.stringify(routingMessagesFromJsonl(jsonl)).includes("SPECIAL-BODY-TOKEN"));
  const result = searchRoutingMessages(jsonl, "special-body-token /feature/", "all");
  assert.equal(result.matchedMessageCount, 1); assert.equal(result.hits[0].offset, 19);
  assert.equal(result.hits[0].timestamp, "2026-10-01T00:00:00Z");
  assert.match(result.hits[0].excerpt, /SPECIAL-BODY-TOKEN/);
  assert.ok(result.hits[0].excerpt.length <= 802);
  assert.match(routingMessagesFromJsonl(jsonl, result.hits[0].offset, "SPECIAL-BODY-TOKEN").messages[0].text, /SPECIAL-BODY-TOKEN/);
  assert.equal(searchRoutingMessages(jsonl, "special-body-token missing", "all").matchedMessageCount, 0);
  assert.equal(searchRoutingMessages(jsonl, "special-body-token missing", "any").matchedMessageCount, 1);
  assert.equal(searchRoutingMessages(jsonl, "  ").matchedMessageCount, 0);
});

test("body search never exposes tool results, thinking, or abandoned branches", () => {
  const rows = [
    { type: "message", id: "root", parentId: null, message: { role: "user", content: "Actual topic" } },
    { type: "message", id: "abandoned", parentId: "root", message: { role: "assistant", content: "PRIVATE-MATCH" } },
    { type: "message", id: "tool", parentId: "root", message: { role: "toolResult", content: [{ type: "text", text: "PRIVATE-MATCH" }] } },
    { type: "message", id: "last", parentId: "tool", message: { role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE-MATCH" }, { type: "text", text: "Actual answer" }] } },
  ];
  assert.equal(searchRoutingMessages(rows.map(e => JSON.stringify(e)).join("\n"), "PRIVATE-MATCH").matchedMessageCount, 0);
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
