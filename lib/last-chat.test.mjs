import assert from "node:assert/strict";
import test from "node:test";
import { getLastChat, rememberLastChat, forgetLastChat, LAST_CHAT_STORAGE_KEY } from "./last-chat.ts";

function store() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
test("remembers a single last conversation across projects for explicit return only", () => {
  const storage = store(); assert.equal(getLastChat(storage), null);
  rememberLastChat("project-a-chat", storage); assert.equal(getLastChat(storage), "project-a-chat");
  rememberLastChat("project-b-chat", storage); assert.equal(getLastChat(storage), "project-b-chat");
  assert.equal(storage.getItem(LAST_CHAT_STORAGE_KEY), "project-b-chat");
  // Reading or remembering an ID performs no network request or navigation.
});
test("forgetting a deleted chat never clears a more recently selected one", () => {
  const storage = store(); rememberLastChat("latest", storage);
  forgetLastChat("older", storage); assert.equal(getLastChat(storage), "latest");
  forgetLastChat("latest", storage); assert.equal(getLastChat(storage), null);
});
test("empty or oversized values and unavailable browser storage are harmless", () => {
  const storage = store(); rememberLastChat("valid", storage);
  rememberLastChat(" ", storage); rememberLastChat("x".repeat(257), storage); assert.equal(getLastChat(storage), "valid");
  storage.setItem(LAST_CHAT_STORAGE_KEY, "x".repeat(257)); assert.equal(getLastChat(storage), null);
  assert.equal(getLastChat(null), null); rememberLastChat("valid", null); forgetLastChat("valid", null);
  const denied = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(getLastChat(denied), null); rememberLastChat("valid", denied); forgetLastChat("valid", denied);
});
