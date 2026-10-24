import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession, createExtensionRuntime, getAgentDir, SessionManager, SettingsManager,
  type ModelRuntime, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { getModelRuntimeWithExtensions } from "./model-runtime";
import { listAllSessions } from "./session-reader";
import { createSessionRouterTools, routingMessagesFromJsonl, type RouterCatalog } from "./session-router-tools";
import { ROUTER_MODEL, ROUTER_PROVIDER, type SessionRouteResult } from "./session-routing";

export async function readRoutingCatalog(): Promise<RouterCatalog> {
  const sessions = (await listAllSessions()).filter(s => !s.transient && s.relation?.kind !== "subagent");
  return {
    sessions,
    async read(session, offset) {
      // Paths originate only from this instance's catalog, never from model arguments.
      if ((await stat(session.path)).size > 32 * 1024 * 1024) throw new Error("Session is too large for this router preview");
      return routingMessagesFromJsonl(await readFile(session.path, "utf8"), offset);
    },
  };
}

/** A disposable Pi session with a bundled Skill and exactly three routing tools. */
export async function routeSessionTask(message: string, options: {
  signal: AbortSignal;
  catalog?: RouterCatalog;
  modelRuntime?: ModelRuntime;
}): Promise<SessionRouteResult> {
  const catalog = options.catalog ?? await readRoutingCatalog();
  options.signal.throwIfAborted();
  if (!catalog.sessions.length) return { kind: "choose", candidates: [], message: "当前实例还没有可继续的会话，请先使用普通聊天。" };
  const runtime = options.modelRuntime ?? await getModelRuntimeWithExtensions();
  options.signal.throwIfAborted();
  const model = runtime.getModel(ROUTER_PROVIDER, ROUTER_MODEL);
  if (!model) throw new Error("ROUTER_MODEL_UNAVAILABLE");
  const skill = await readFile(join(process.cwd(), "bin/skills/route-session/SKILL.md"), "utf8");
  const routing = createSessionRouterTools(catalog, options.signal);
  // No discovered extensions, AGENTS files, MCP, shell, filesystem tools or user settings.
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => `You are a read-only session router, not a task executor. Follow this Skill.\n\n${skill}`,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources: () => {}, reload: async () => {},
  };
  const cwd = getAgentDir();
  const { session } = await createAgentSession({
    cwd, agentDir: cwd, modelRuntime: runtime, model, thinkingLevel: "low",
    tools: routing.tools.map(tool => tool.name), customTools: routing.tools, resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({
      defaultTools: [], compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off",
    }),
  });
  const abort = () => { void session.abort(); };
  options.signal.addEventListener("abort", abort, { once: true });
  let turns = 0;
  let exceeded = false;
  const unsubscribe = session.subscribe(event => {
    if (event.type === "turn_start" && ++turns > 12) {
      exceeded = true;
      queueMicrotask(abort);
    }
  });
  try {
    const active = session.getActiveToolNames();
    const allowed = new Set(routing.tools.map(tool => tool.name));
    if (active.length !== allowed.size || active.some(name => !allowed.has(name))) throw new Error("ROUTER_TOOL_ISOLATION_FAILED");
    options.signal.throwIfAborted();
    await session.prompt(message);
    options.signal.throwIfAborted();
    if (exceeded) throw new Error("ROUTER_BUDGET_EXCEEDED");
    const selected = routing.getSelection();
    if (selected) {
      // Verify a deleted target isn't forwarded blindly after a long routing run.
      await catalog.read(selected.target, 0);
      return { kind: "open", target: selected.target, reason: selected.reason };
    }
    const lastAssistant = session.messages.findLast(entry => entry.role === "assistant");
    if (lastAssistant?.role === "assistant" && ["error", "aborted"].includes(lastAssistant.stopReason)) throw new Error("ROUTER_PROVIDER_FAILED");
    return { kind: "choose", candidates: routing.getCandidates(),
      message: session.getLastAssistantText()?.slice(0, 2000) || "暂时无法确定目标，请选择会话或补充任务描述。" };
  } finally {
    options.signal.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }
}
