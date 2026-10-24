import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./ModelSelector.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("ModelSelector.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let rootStyle;
function visit(node) {
  if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(
    attr => ts.isJsxAttribute(attr) && attr.name.getText(ast) === "ref" && attr.initializer?.getText(ast) === "{rootRef}",
  )) {
    rootStyle = node.attributes.properties.find(attr => attr.name?.getText(ast) === "style").initializer.expression.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(rootStyle);
const buttonStart = source.indexOf("const buttonStyle:");
const buttonEnd = source.indexOf("  const choose", buttonStart);
const styles = new Script(stripTypeScriptTypes(`${source.slice(buttonStart, buttonEnd)}\n({ button: buttonStyle, root: ${rootStyle} });`));

for (const isMobile of [true, false]) {
  test(`toolbar selector stays content-sized on ${isMobile ? "mobile" : "desktop"}`, () => {
    const { button, root } = styles.runInNewContext({ variant: "toolbar", isMobile, locked: false, open: false });
    assert.equal(root.width, undefined);
    assert.equal(root.flex, isMobile ? "0 1 auto" : undefined);
    assert.equal(button.width, undefined);
    assert.equal(button.maxWidth, 220);
    assert.equal(root.minWidth, 0);
  });
  test(`field selector remains full-width on ${isMobile ? "mobile" : "desktop"}`, () => {
    const { button, root } = styles.runInNewContext({ variant: "field", isMobile, locked: false, open: false });
    assert.equal(root.width, "100%");
    assert.equal(button.width, "100%");
  });
}

test("composer attachment/model group does not grow to fill the mobile toolbar", () => {
  const chatInput = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(chatInput, /flex: isMobile \? "0 1 auto" : "0 0 auto", minWidth: 0/);
});
