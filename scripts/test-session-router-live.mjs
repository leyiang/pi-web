// Explicit, opt-in real Luna check. Fixtures are in memory; no target task is sent.
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { configureHttpDispatcher } = await jiti.import("../lib/http-dispatcher.ts");
configureHttpDispatcher();
const { routeSessionTask } = await jiti.import("../lib/session-router.ts");

const sessions = [
  { id: "router-test-piano", path: "/fixture/piano.jsonl", cwd: "/projects/piano", name: "钢琴节拍练习", firstMessage: "调整节拍练习", created: "", modified: "2026-10-24", messageCount: 2 },
  { id: "router-test-web", path: "/fixture/web.jsonl", cwd: "/projects/pi-web", name: "Pi Web 手机 composer", firstMessage: "把更多控件改成竖向菜单", created: "", modified: "2026-10-24", messageCount: 2 },
];
const reviewed = [];
const result = await routeSessionTask("继续调整 Pi Web 手机端 composer 的更多控件菜单，把刷新放到关闭菜单下面。", {
  signal: AbortSignal.timeout(90_000),
  catalog: { sessions, async read(session) {
    reviewed.push(session.id);
    return { messages: [{ role: "user", text: session.firstMessage }, { role: "assistant", text: session.id.endsWith("web")
      ? "已实现竖向菜单和页面刷新，Stop 独立显示。" : "已修正节拍器的速度设置。" }], hasMore: false };
  } },
});
assert.equal(result.kind, "open");
assert.equal(result.target.id, "router-test-web");
assert.ok(reviewed.includes("router-test-web"));
console.log("PASS real GPT-6 Luna: read candidate context and called open_session for the correct target; no task executed or session written");
