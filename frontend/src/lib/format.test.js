import test from "node:test";
import assert from "node:assert/strict";
import { activityMeta, fmtPace, fmtNum } from "./format.js";

test("activity labels are sport-specific", () => {
  assert.equal(activityMeta("open_water_swimming").label, "Swim");
  assert.equal(activityMeta("kayaking").label, "Paddle");
  assert.equal(activityMeta("strength_training").label, "Strength");
});

test("numbers and pace have bounded display precision", () => {
  assert.equal(fmtPace(451.3), "7:31/km");
  assert.equal(fmtNum(23.543634, 1), "23.5");
});
