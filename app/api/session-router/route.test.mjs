import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const security = await jiti.import("../../../lib/request-security.ts");
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function endpoint(routeSessionTask) {
  const exports = {};
  new Script(js).runInNewContext({ exports, AbortSignal, Request, Response, Error,
    require(name) {
      if (name === "next/server") return require(name);
      if (name === "@/lib/request-security") return security;
      if (name === "@/lib/session-router") return { routeSessionTask };
      if (name === "@/lib/session-routing") return { MAX_ROUTING_MESSAGE_LENGTH: 8000 };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return exports.POST;
}
const request = (body, extra = {}) => new Request("http://localhost/api/session-router", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...extra,
});

test("invalid tasks and content types never call the model", async () => {
  const post = endpoint(() => assert.fail("must not invoke model"));
  for (const body of [{}, { message: 123 }, { message: "  " }, { message: "a".repeat(8001) }]) {
    assert.equal((await post(request(body))).status, 400);
  }
  assert.equal((await post(request({}, { body: "{bad" }))).status, 400);
  assert.equal((await post(request({}, { headers: { "Content-Type": "text/plain" } }))).status, 415);
});

test("success returns the structured tool decision and passes the original message with cancellation", async () => {
  const post = endpoint(async (message, options) => {
    assert.equal(message, "  original\nmessage  "); assert.ok(options.signal instanceof AbortSignal);
    return { kind: "choose", candidates: [], message: "No matching session" };
  });
  const response = await post(request({ message: "  original\nmessage  " }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).kind, "choose");
});

test("provider errors do not disclose credentials; missing Luna and aborts are explicit", async () => {
  const failed = await endpoint(() => { throw new Error("SECRET_PROVIDER_CREDENTIAL"); })(request({ message: "task" }));
  assert.equal(failed.status, 502); assert.doesNotMatch(await failed.text(), /SECRET_PROVIDER_CREDENTIAL/);
  const missing = await endpoint(() => { throw new Error("ROUTER_MODEL_UNAVAILABLE"); })(request({ message: "task" }));
  assert.equal(missing.status, 503);
  const abort = new AbortController(); abort.abort();
  const cancelled = await endpoint((_message, options) => { options.signal.throwIfAborted(); })(request({ message: "task" }, { signal: abort.signal }));
  assert.equal(cancelled.status, 504);
});

test("only two router runs can be active, and slots are released after completion", async () => {
  const gate = Promise.withResolvers();
  const post = endpoint(async () => { await gate.promise; return { kind: "choose", candidates: [], message: "done" }; });
  const first = post(request({ message: "one" })); const second = post(request({ message: "two" }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await post(request({ message: "three" }))).status, 429);
  gate.resolve(); assert.equal((await first).status, 200); assert.equal((await second).status, 200);
  assert.equal((await post(request({ message: "four" }))).status, 200);
});
