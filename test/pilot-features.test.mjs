import test from "node:test";
import assert from "node:assert/strict";
import { TestSuiteService } from "../dist/services/test-suite-service.js";
import { NotificationService } from "../dist/services/notification-service.js";

test("test suites create child runs and aggregate their status", () => {
  const suites = new Map();
  const suiteRuns = new Map();
  const repository = {
    createSuite: (record) => suites.set(record.id, structuredClone(record)),
    getSuite: (id) => structuredClone(suites.get(id)),
    listSuites: () => [...suites.values()].map(structuredClone),
    createRun: (record) => suiteRuns.set(record.id, structuredClone(record)),
    getRun: (id) => structuredClone(suiteRuns.get(id)),
    listRuns: () => [...suiteRuns.values()].map(structuredClone)
  };
  const saved = new Map([
    ["saved-1", { testCase: testCase("CASE-1") }],
    ["saved-2", { testCase: testCase("CASE-2") }]
  ]);
  const childRuns = new Map();
  let sequence = 0;
  const runService = {
    create: (testCaseValue) => {
      const record = {
        id: `run-${++sequence}`,
        status: "queued",
        testCase: testCaseValue,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      childRuns.set(record.id, record);
      return structuredClone(record);
    },
    get: (id) => structuredClone(childRuns.get(id))
  };
  const service = new TestSuiteService(
    repository,
    { get: (id) => structuredClone(saved.get(id)) },
    runService
  );

  const suite = service.create("Smoke", ["saved-1", "saved-2", "saved-1"]);
  assert.deepEqual(suite.testCaseIds, ["saved-1", "saved-2"]);
  const launched = service.run(suite.id);
  assert.equal(launched.status, "queued");
  assert.equal(launched.runIds.length, 2);

  for (const id of launched.runIds) {
    const child = childRuns.get(id);
    child.status = "completed";
    child.result = {
      runId: id,
      testCaseId: child.testCase.id,
      status: "passed",
      startedAt: child.createdAt,
      finishedAt: child.updatedAt,
      steps: []
    };
  }
  assert.equal(service.getRun(launched.id).status, "passed");
});

test("notifications deliver generic webhook and Telegram payloads", async () => {
  const requests = [];
  const service = new NotificationService(
    {
      NOTIFICATION_WEBHOOK_URL: "https://hooks.example.test/qa",
      TELEGRAM_BOT_TOKEN: "bot-token",
      TELEGRAM_CHAT_ID: "123"
    },
    async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response("ok", { status: 200 });
    }
  );

  const result = await service.sendTest();
  assert.deepEqual(result, { attempted: 2, delivered: 2 });
  assert.equal(requests[0].body.event, "test_run.completed");
  assert.match(requests[1].url, /api\.telegram\.org/);
  assert.equal(requests[1].body.chat_id, "123");
});

function testCase(id) {
  return {
    id,
    name: id,
    platform: "web",
    steps: [{ id: "1", action: "wait", value: "0" }]
  };
}
