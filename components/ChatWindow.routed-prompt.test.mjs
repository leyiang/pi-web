import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { Script } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const begin = source.indexOf("  const initialPromptSentRef = useRef(false);");
const end = source.indexOf("  // One sound", begin);
assert.ok(begin >= 0 && end > begin);
const effect = new Script(source.slice(begin, end));

for (const followUp of [undefined, false, true]) {
  test(`initial prompt delivers only once; follow-up=${followUp}`, () => {
    const calls = [];
    effect.runInNewContext({ initialPrompt: "  original\ntext  ", initialPromptFollowUp: followUp, loading: false, error: null,
      useRef: value => ({ current: value }), useEffect(fn) { fn(); fn(); },
      onInitialPromptConsumed: () => calls.push("consumed"),
      handleSend: value => calls.push(["normal", value]),
      handlePromptWithStreamingBehavior: (value, mode) => calls.push(["routed", value, mode]),
    });
    assert.deepEqual(calls, ["consumed", followUp ? ["routed", "  original\ntext  ", "followUp"] : ["normal", "  original\ntext  "]]);
  });
}

test("routing waits for history load and preserves initial prompt on a loading error", () => {
  for (const state of [{ loading: true, error: null }, { loading: false, error: "failed" }]) {
    const fail = () => assert.fail("must not send before history is ready");
    effect.runInNewContext({ ...state, initialPrompt: "task", initialPromptFollowUp: true,
      useRef: value => ({ current: value }), useEffect: fn => fn(), onInitialPromptConsumed: fail,
      handleSend: fail, handlePromptWithStreamingBehavior: fail,
    });
  }
});

test("AppShell deduplicates routed request IDs without rewriting the original task", () => {
  const app = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
  const start = app.indexOf("  const handleRoutedTask = useCallback");
  const stop = app.indexOf("  // The sidebar calls", start);
  const calls = [];
  const context = { useCallback: fn => fn, routedRequestIdsRef: { current: new Set() },
    handleSelectSession: target => calls.push(["select", target.id]),
    setPendingRoutedPrompt: value => calls.push(["pending", JSON.parse(JSON.stringify(value))]),
    setSessionKey() {}, setSessionRouterOpen() {},
  };
  new Script(stripTypeScriptTypes(app.slice(start, stop)) + '\nglobalThis.deliver = handleRoutedTask;').runInNewContext(context);
  const task = { requestId: "once", target: { id: "target" }, message: "  exact task  " };
  context.deliver(task); context.deliver(task);
  assert.deepEqual(calls, [["select", "target"], ["pending", { sessionId: "target", text: "  exact task  " }]]);
});
