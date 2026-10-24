// Explicit, opt-in real Luna check. Fixtures are in memory; no target task is sent.
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { configureHttpDispatcher } = await jiti.import("../lib/http-dispatcher.ts");
configureHttpDispatcher();
const { routeSessionTask } = await jiti.import("../lib/session-router.ts");
const { searchRoutingMessages } = await jiti.import("../lib/session-router-tools.ts");
function messages(session) {
  return [{ role: "user", text: session.firstMessage }, { role: "assistant", text: session.cwd === "/projects/pi-web"
    ? session.id === "router-test-web" ? "Pi Web 最近已实现竖向菜单和页面刷新，Stop 独立显示。" : "Pi Web 已完成较早一版横向控件栏，后续继续调整菜单。"
    : session.cwd === "/projects/ledger" ? "已完成 SQLite 旧账迁移，下一步核对迁移数据。" : "已修正节拍器的速度设置。" }];
}
async function search(session, query, match) {
  const jsonl = messages(session).map((message, index) => JSON.stringify({ type: "message", id: String(index),
    parentId: index ? String(index - 1) : null, message: { role: message.role, content: message.text } })).join("\n");
  return searchRoutingMessages(jsonl, query, match);
}

const sessions = [
  { id: "router-test-piano", path: "/fixture/piano.jsonl", cwd: "/projects/piano", name: "钢琴节拍练习", firstMessage: "调整节拍练习", created: "", modified: "2026-10-25", messageCount: 2 },
  { id: "router-test-web-old", path: "/fixture/old.jsonl", cwd: "/projects/pi-web", name: "Pi Web 手机 composer", firstMessage: "把更多控件改成竖向菜单", created: "", modified: "2026-10-18", messageCount: 2 },
  { id: "router-test-web", path: "/fixture/web.jsonl", cwd: "/projects/pi-web", name: "Pi Web 手机 composer", firstMessage: "把更多控件改成竖向菜单", created: "", modified: "2026-10-24", messageCount: 2 },
];
const reviewed = [];
const result = await routeSessionTask("继续调整 Pi Web 手机端 composer 的更多控件菜单，把刷新放到关闭菜单下面。", {
  signal: AbortSignal.timeout(90_000),
  catalog: { sessions, async read(session) {
    reviewed.push(session.id);
    return { messages: messages(session), hasMore: false };
  }, search },
});
assert.equal(result.kind, "open");
assert.equal(result.target.id, "router-test-web");
assert.ok(reviewed.includes("router-test-web"));
console.log("PASS real GPT-6 Luna: chooses the newest relevant continuation, not the older same-project chat or the newest unrelated chat");

const older = { id: "router-test-legacy", path: "/fixture/legacy.jsonl", cwd: "/projects/ledger", name: "SQLite 旧账迁移", firstMessage: "迁移旧 SQLite 账本", created: "", modified: "2026-01-01", messageCount: 2 };
const recentUnrelated = Array.from({ length: 31 }, (_, i) => ({ ...sessions[0], id: `piano-${i}`,
  modified: new Date(Date.UTC(2026, 9, i + 1)).toISOString() }));
const fallback = await routeSessionTask("继续之前的 SQLite 旧账本迁移，检查迁移进展。", {
  signal: AbortSignal.timeout(90_000),
  catalog: { sessions: [older, ...recentUnrelated], async read(session) {
    return { messages: messages(session), hasMore: false };
  }, search },
});
assert.equal(fallback.kind, "open");
assert.equal(fallback.target.id, older.id);
console.log("PASS real GPT-6 Luna: expands beyond the latest 30 only when recent conversations are unrelated; no task executed or session written");
