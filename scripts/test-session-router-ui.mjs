// Browser checks with synthetic history and intercepted delivery; never prompt a real agent.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.PI_WEB_TEST_URL || "https://pi-dev.tr0.cc";
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: ["--no-proxy-server", ...(process.env.PI_WEB_TEST_HOST_IP ? [`--host-resolver-rules=MAP ${new URL(base).hostname} ${process.env.PI_WEB_TEST_HOST_IP}`] : [])] });
const target = { id: "router-ui-test", path: "/fixture/session.jsonl", cwd: "/data/Work/pi-web-dev", name: "Router UI fixture",
  firstMessage: "Fixture history", created: "2026-10-25", modified: "2026-10-25", messageCount: 2 };
const model = { provider: "openai-codex", modelId: "gpt-6-luna" };

async function setup({ choose = false, failed = false, running = false, mobile = false, remember = true, missing = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 850 }, isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(remember => {
    if (!remember) return;
    sessionStorage.setItem("pi-web:tab-open-session", JSON.stringify({ kind: "session", sessionId: "router-ui-test" }));
    localStorage.setItem("pi-web:last-open-by-workspace", JSON.stringify({ "/data/Work/pi-web-dev": "router-ui-test" }));
  }, remember);
  const page = await context.newPage();
  const prompts = [], routes = [], errors = [], created = [];
  page.on("pageerror", error => errors.push(error.message));
  const state = { sessionId: target.id, isStreaming: running, isPromptRunning: running, messages: [], thinkingLevel: "low", model };
  await page.route("**/api/**", async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (path === "/api/session-router") {
      routes.push(request.postDataJSON());
      return failed ? json({ error: "Synthetic routing failure" }, 502) : json(choose
        ? { kind: "choose", candidates: [target], message: "Choose a destination" }
        : { kind: "open", target, reason: "Matching project" });
    }
    if (path === "/api/sessions") return json({ sessions: [target], sessionListVersion: 1, runningSessionIds: running ? [target.id] : [] });
    if (path === `/api/sessions/${target.id}` && missing) return json({ error: "Session not found" }, 404);
    if (path === `/api/sessions/${target.id}`) return json({ sessionId: target.id, filePath: target.path, totalActiveMs: 0, leafId: "a", tree: [], treeFormat: "summary",
      context: { messages: [{ role: "user", content: "Fixture history", timestamp: 1 }, { role: "assistant", provider: model.provider, model: model.modelId, content: [{ type: "text", text: "Fixture answer" }], timestamp: 2 }],
        entryIds: ["u", "a"], oldestEntryId: "u", hasMore: false, turnsBefore: 0, thinkingLevel: "low", model } });
    if (path === `/api/sessions/${target.id}/state` || path === `/api/agent/${target.id}` && request.method() === "GET") return json({ running: true, state });
    if (path === "/api/agent/running") return json({ runningSessionIds: running ? [target.id] : [], awaitingInputSessionIds: [], sessionListVersion: 1 });
    if (path.endsWith("/events") && path.startsWith("/api/agent/")) return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "connected", isStreaming: running })}\n\n` });
    if (path === `/api/agent/${target.id}` && request.method() === "POST") {
      const command = request.postDataJSON(); if (command.type === "prompt") prompts.push(command);
      return json({ success: true, data: command.type === "get_tools" ? []
        : command.type === "get_commands" ? { commands: [] } : command.type === "get_state" ? state : {} });
    }
    if (path === "/api/agent/new") { created.push(request.postDataJSON()); return json({ sessionId: target.id }); }
    if (path === "/api/cwd/validate") return json({ cwd: target.cwd });
    if (path === "/api/default-cwd") return json({ cwd: target.cwd });
    if (path === "/api/project-trust") return json({ trusted: true, requiresTrust: false });
    // Never mutate real data in this browser test, even if unrelated UI asks.
    if (request.method() !== "GET") return json({ success: true, data: {} });
    return route.continue();
  });
  return { context, page, prompts, routes, errors, created };
}

async function waitForPrompt(page, trigger) {
  const waiting = page.waitForRequest(request => {
    if (!request.url().endsWith(`/api/agent/${target.id}`) || request.method() !== "POST") return false;
    try { return request.postDataJSON().type === "prompt"; } catch { return false; }
  }, { timeout: 60000 }).then(request => ({ request }), error => ({ error }));
  await trigger();
  try { const outcome = await waiting; if (outcome.error) throw outcome.error; } catch (error) {
    console.error("Delivery diagnostics:", page.url(), await page.locator('[role="alert"]').allTextContents(),
      "chat windows:", await page.locator(".chat-content").count(), "body:", (await page.locator("body").innerText()).slice(-1200));
    throw error;
  }
  await page.locator(".chat-content").waitFor();
}

try {
  {
    const t = await setup(); await t.page.goto(base, { waitUntil: "networkidle" });
    const back = t.page.getByRole("button", { name: "Return to last chat", exact: true });
    await back.waitFor(); assert.equal(t.routes.length, 0); assert.equal(t.prompts.length, 0);
    await back.click(); await t.page.locator(".chat-content").waitFor();
    await t.page.waitForURL(url => url.searchParams.get("session") === target.id);
    assert.equal(t.routes.length, 0); assert.equal(t.prompts.length, 0);
    assert.equal(await t.page.evaluate(() => localStorage.getItem("pi-web:last-chat")), target.id);
    await t.page.getByRole("button", { name: "Session router", exact: true }).click();
    await back.waitFor(); await back.click(); await t.page.locator(".chat-content").waitFor();
    await t.page.waitForURL(url => url.searchParams.get("session") === target.id);
    assert.equal(t.routes.length, 0); assert.equal(t.prompts.length, 0); assert.deepEqual(t.errors, []);
    console.log("PASS manual Return restores last chat, persists its ID, and never routes or sends a message"); await t.context.close();
  }
  {
    const t = await setup({ remember: false }); await t.page.goto(base, { waitUntil: "networkidle" });
    assert.equal(await t.page.getByRole("button", { name: "Return to last chat", exact: true }).isDisabled(), true);
    assert.equal(t.prompts.length, 0); console.log("PASS Return disabled when no history exists"); await t.context.close();
  }
  {
    const t = await setup({ missing: true }); await t.page.goto(base, { waitUntil: "networkidle" });
    await t.page.getByRole("button", { name: "Return to last chat", exact: true }).click();
    await t.page.getByRole("alert").filter({ hasText: "no longer available" }).waitFor();
    assert.equal(await t.page.getByRole("button", { name: "Return to last chat", exact: true }).isDisabled(), true);
    assert.equal(t.prompts.length, 0); assert.equal(t.routes.length, 0); assert.deepEqual(t.errors, []);
    console.log("PASS deleted last chat reports an error without navigation or sending"); await t.context.close();
  }
  for (const running of [false, true]) {
    const t = await setup({ running, mobile: running });
    await t.page.goto(base, { waitUntil: "networkidle", timeout: 60000 });
    const input = t.page.getByRole("textbox", { name: "Task to route", exact: true }); await input.waitFor();
    const original = "  Continue the composer menu\nKeep this text unchanged  ";
    await input.fill(original);
    await waitForPrompt(t.page, () => t.page.getByRole("button", { name: "Find conversation and send", exact: true }).click());
    assert.equal(t.prompts.length, 1); assert.equal(t.prompts[0].message, original); assert.equal(t.prompts[0].streamingBehavior, "followUp");
    await t.page.waitForURL(url => url.searchParams.get("session") === target.id, { timeout: 15000 });
    assert.equal(t.created.length, 0);
    await t.page.reload({ waitUntil: "domcontentloaded" }); await t.page.locator(".chat-content").waitFor();
    await t.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(t.prompts.length, 1, "reload must not resend routed task"); assert.deepEqual(t.errors, []);
    console.log(`PASS ${running ? "mobile busy" : "desktop idle"}: home ignores old memory; routes original exactly once; follow-up delivery; reload does not resend`);
    await t.context.close();
  }
  {
    const t = await setup({ choose: true }); await t.page.goto(base);
    await t.page.getByRole("textbox", { name: "Task to route", exact: true }).fill("Ambiguous task");
    await t.page.getByRole("button", { name: "Find conversation and send", exact: true }).click();
    await t.page.getByText("Choose a destination", { exact: true }).waitFor(); assert.equal(t.prompts.length, 0);
    await waitForPrompt(t.page, () => t.page.getByRole("button", { name: /Router UI fixture/ }).click());
    assert.equal(t.prompts.length, 1); assert.equal(t.prompts[0].message, "Ambiguous task"); assert.deepEqual(t.errors, []);
    console.log("PASS ambiguous route waits for explicit selection"); await t.context.close();
  }
  {
    const t = await setup({ failed: true }); await t.page.goto(base);
    const input = t.page.getByRole("textbox", { name: "Task to route", exact: true }); await input.fill("Keep on failure");
    await t.page.getByRole("button", { name: "Find conversation and send", exact: true }).click();
    await t.page.getByRole("alert").filter({ hasText: "Synthetic routing failure" }).waitFor();
    assert.equal(await input.inputValue(), "Keep on failure"); assert.equal(t.prompts.length, 0);
    await t.page.getByRole("button", { name: "Normal chat", exact: true }).click();
    await t.page.locator("textarea.chat-input-textarea").waitFor(); assert.deepEqual(t.errors, []);
    console.log("PASS routing failure retains task; normal composer remains available"); await t.context.close();
  }
  {
    const t = await setup(); await t.page.goto(`${base}/?session=${target.id}`);
    await t.page.locator(".chat-content").waitFor(); assert.equal(t.routes.length, 0); assert.equal(t.prompts.length, 0);
    assert.equal(await t.page.getByRole("textbox", { name: "Task to route", exact: true }).count(), 0);
    assert.deepEqual(t.errors, []); console.log("PASS explicit session link bypasses router without sending a task");
    await t.page.locator("textarea.chat-input-textarea").fill("Normal chat still works");
    await waitForPrompt(t.page, () => t.page.locator("fieldset").getByRole("button", { name: "Send", exact: true }).click());
    assert.equal(t.prompts.length, 1); assert.equal(t.prompts[0].message, "Normal chat still works");
    assert.equal(t.prompts[0].streamingBehavior, undefined); assert.equal(t.routes.length, 0); assert.deepEqual(t.errors, []);
    console.log("PASS ordinary chat sends directly through its unchanged prompt path"); await t.context.close();
  }
} finally { await browser.close(); }
