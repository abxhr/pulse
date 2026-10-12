import test from "node:test";
import assert from "node:assert/strict";
import { fetchCached, invalidate, resetCache } from "./useApi.js";

test("concurrent callers share one request and the result is cached", async () => {
  resetCache();
  let calls = 0;
  const fetcher = async () => { calls++; return { n: calls }; };
  const [a, b] = await Promise.all([fetchCached("k", fetcher), fetchCached("k", fetcher)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  await fetchCached("k", fetcher);
  assert.equal(calls, 1);
});

test("entries expire after the ttl and can be invalidated by prefix", async () => {
  resetCache();
  let t = 0;
  const now = () => t;
  let calls = 0;
  const fetcher = async () => ++calls;
  await fetchCached("a:1", fetcher, 1000, now);
  t = 999;
  await fetchCached("a:1", fetcher, 1000, now);
  assert.equal(calls, 1);
  t = 1001;
  await fetchCached("a:1", fetcher, 1000, now);
  assert.equal(calls, 2);
  invalidate("a:");
  await fetchCached("a:1", fetcher, 1000, now);
  assert.equal(calls, 3);
});

test("failures are not cached, so a retry refetches", async () => {
  resetCache();
  let calls = 0;
  const flaky = async () => { calls++; if (calls === 1) throw new Error("boom"); return "ok"; };
  await assert.rejects(fetchCached("f", flaky), /boom/);
  assert.equal(await fetchCached("f", flaky), "ok");
  assert.equal(calls, 2);
});
