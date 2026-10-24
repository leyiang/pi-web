// Direct read-only diagnostic: only the AI initiates searches. Never forwards a task.
import { parseArgs } from "node:util";
import { createJiti } from "jiti";
const { values } = parseArgs({ options: { message: { type: "string" } } });
if (!values.message?.trim()) throw new Error("Usage: node scripts/diagnose-session-router.mjs --message '<task>'");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { configureHttpDispatcher } = await jiti.import("../lib/http-dispatcher.ts");
configureHttpDispatcher();
const { readRoutingCatalog, routeSessionTask } = await jiti.import("../lib/session-router.ts");
const catalog = await readRoutingCatalog();
const searches = new Map();
const reads = [];
const result = await routeSessionTask(values.message, {
  signal: AbortSignal.timeout(90_000),
  catalog: {
    sessions: catalog.sessions,
    read: async (session, offset, query) => {
      reads.push({ id: session.id, title: session.name || session.firstMessage.slice(0, 100), offset, query });
      return catalog.read(session, offset, query);
    },
    search: async (session, query, match) => {
      const key = JSON.stringify([query, match]);
      if (!searches.has(key)) searches.set(key, { query, match, scanned: 0, hits: [] });
      const trace = searches.get(key); trace.scanned++;
      const found = await catalog.search(session, query, match);
      if (found.matchedMessageCount) trace.hits.push({ id: session.id, matchedMessages: found.matchedMessageCount });
      return found;
    },
  },
});
console.log(JSON.stringify({ input: values.message, result: result.kind === "open"
  ? { kind: result.kind, id: result.target.id, title: result.target.name || result.target.firstMessage.slice(0, 120), reason: result.reason }
  : { kind: result.kind, message: result.message, candidates: result.candidates.map(s => ({ id: s.id, title: s.name || s.firstMessage.slice(0, 120) })) },
  agentChosenSearches: [...searches.values()], readSessions: reads }, null, 2));
