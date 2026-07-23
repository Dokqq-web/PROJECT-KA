import test from "node:test";
import assert from "node:assert/strict";
import {
  MetricsService,
  normalizeRoute
} from "../dist/operations/metrics-service.js";

test("metrics aggregate requests without high-cardinality IDs", () => {
  const metrics = new MetricsService();
  const route = normalizeRoute("/runs/7cc22dd1-99e0-4c75-bb2c-a10c55191b3b");
  metrics.observe("GET", route, 200, 125);
  metrics.observe("GET", route, 200, 75);
  const output = metrics.render({ active: 1, queued: 2, limit: 3 }, 10);

  assert.equal(route, "/runs/:id");
  assert.match(output, /qa_bot_http_requests_total.* 2/);
  assert.match(output, /qa_bot_queue_active 1/);
  assert.match(output, /qa_bot_queue_queued 2/);
  assert.match(output, /qa_bot_process_uptime_seconds 10.000/);
});
