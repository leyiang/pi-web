import assert from "node:assert/strict";
import test from "node:test";
import manifest, { dynamic } from "./manifest.ts";

test("manifest reads the app name at runtime without changing other metadata", () => {
  const original = process.env.PI_WEB_APP_NAME;
  const originalMode = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.equal(dynamic, "force-dynamic");
    delete process.env.PI_WEB_APP_NAME;
    const defaults = manifest();
    assert.equal(defaults.name, "Pi Web");
    assert.equal(defaults.short_name, "Pi Web");

    // Reuse the same imported function: the environment must not be captured
    // at module load time (or baked into a statically generated manifest).
    for (const [value, expected] of [
      ["", "Pi Web"],
      [" \t\n ", "Pi Web"],
      ["Work Pi", "Work Pi"],
      ["  工作 Pi 🚀 \n", "工作 Pi 🚀"],
      ["Another Pi", "Another Pi"],
    ]) {
      process.env.PI_WEB_APP_NAME = value;
      assert.deepEqual(manifest(), {
        ...defaults,
        name: expected,
        short_name: expected,
      });
    }
  } finally {
    if (original === undefined) delete process.env.PI_WEB_APP_NAME;
    else process.env.PI_WEB_APP_NAME = original;
    if (originalMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalMode;
  }
});

test("only development uses DEV icons and the default Dev name", () => {
  const original = process.env.PI_WEB_APP_NAME;
  const originalMode = process.env.NODE_ENV;
  try {
    delete process.env.PI_WEB_APP_NAME;
    for (const mode of ["development", "production", "test"]) {
      process.env.NODE_ENV = mode;
      const result = manifest();
      const dev = mode === "development";
      assert.equal(result.name, dev ? "Pi Web Dev" : "Pi Web");
      assert.equal(result.short_name, result.name);
      assert.deepEqual(result.icons.map(icon => icon.src), [
        `/icons/icon-192${dev ? "-dev-v1" : ""}.png`,
        `/icons/icon-512${dev ? "-dev-v1" : ""}.png`,
      ]);
      assert.equal(result.id, "/");
      assert.equal(result.start_url, "/");
    }
    process.env.NODE_ENV = "development";
    process.env.PI_WEB_APP_NAME = "  Custom Dev  ";
    assert.equal(manifest().name, "Custom Dev");
    assert.ok(manifest().icons.every(icon => icon.src.includes("-dev-v1")));
  } finally {
    if (original === undefined) delete process.env.PI_WEB_APP_NAME;
    else process.env.PI_WEB_APP_NAME = original;
    if (originalMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalMode;
  }
});
