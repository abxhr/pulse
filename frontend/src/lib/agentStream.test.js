import test from "node:test";
import assert from "node:assert/strict";
import { createLineParser, applyEvent } from "./agentStream.js";

test("parser handles lines split across chunks and skips junk", () => {
  const got = [];
  const p = createLineParser((e) => got.push(e));
  p.push('{"t":"text","d":"he');
  p.push('llo"}\nnot json\n{"t":"end"');
  p.push("}\n");
  assert.deepEqual(got, [{ t: "text", d: "hello" }, { t: "end" }]);
});

test("applyEvent merges text deltas and keeps block order", () => {
  let b = [];
  b = applyEvent(b, { t: "text", d: "a" });
  b = applyEvent(b, { t: "text", d: "b" });
  b = applyEvent(b, { t: "block", b: { type: "chart" } });
  b = applyEvent(b, { t: "text", d: "c" });
  b = applyEvent(b, { t: "status", text: "x" });
  assert.deepEqual(b, [{ type: "text", text: "ab" }, { type: "chart" }, { type: "text", text: "c" }]);
});
