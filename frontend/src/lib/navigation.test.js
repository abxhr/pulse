import test from "node:test";
import assert from "node:assert/strict";
import { hashForRoute, routeFromHash } from "./navigation.js";

const routes = ["dashboard", "training", "settings"];

test("hash routes are bookmarkable and safely bounded", () => {
  assert.equal(routeFromHash("#/training", routes), "training");
  assert.equal(routeFromHash("#settings", routes), "settings");
  assert.equal(routeFromHash("#/unknown", routes), "dashboard");
  assert.equal(hashForRoute("settings"), "#/settings");
});
