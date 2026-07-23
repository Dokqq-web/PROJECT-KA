import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reliableFetch } from "../dist/http/reliable-fetch.js";
import { SqliteRunRepository } from "../dist/repositories/sqlite-run-repository.js";
import { AuditService } from "../dist/security/audit-service.js";
import { MaintenanceService } from "../dist/services/maintenance-service.js";

test("reliable fetch retries transient responses", async () => {
  let attempts = 0;
  const response = await reliableFetch(
    "https://service.example.test/data",
    { retries: 2, retryBaseMs: 1, timeoutMs: 100 },
    async () => {
      attempts += 1;
      return new Response(
        attempts < 3 ? "temporary" : "{\"ok\":true}",
        { status: attempts < 3 ? 503 : 200 }
      );
    }
  );
  assert.equal(response.status, 200);
  assert.equal(attempts, 3);
});

test("maintenance dry-run and cleanup remove expired data and artifacts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qa-bot-maintenance-"));
  const database = join(directory, "test.db");
  const artifacts = join(directory, "artifacts");
  const artifactRunId = "artifact-run-old";
  mkdirSync(join(artifacts, artifactRunId), { recursive: true });
  writeFileSync(join(artifacts, artifactRunId, "result.txt"), "old");

  const runs = new SqliteRunRepository(database);
  const audit = new AuditService(database);
  const oldTimestamp = "2020-01-01T00:00:00.000Z";
  runs.create({
    id: "old-run",
    status: "completed",
    testCase: {
      id: "OLD",
      name: "Old run",
      platform: "web",
      steps: [{ id: "1", action: "wait", value: "0" }]
    },
    createdAt: oldTimestamp,
    updatedAt: oldTimestamp,
    result: {
      runId: artifactRunId,
      testCaseId: "OLD",
      status: "passed",
      startedAt: oldTimestamp,
      finishedAt: oldTimestamp,
      steps: []
    }
  });
  audit.record({
    method: "GET",
    path: "/old",
    statusCode: 200,
    timestamp: oldTimestamp
  });
  const maintenance = new MaintenanceService(runs, audit, artifacts);

  const preview = await maintenance.cleanup(1, true);
  assert.deepEqual(
    { runs: preview.runs, auditEvents: preview.auditEvents, artifacts: preview.artifactDirectories },
    { runs: 1, auditEvents: 1, artifacts: 1 }
  );
  assert.ok(runs.get("old-run"));
  assert.equal(existsSync(join(artifacts, artifactRunId)), true);

  const removed = await maintenance.cleanup(1);
  assert.equal(removed.runs, 1);
  assert.equal(runs.get("old-run"), undefined);
  assert.equal(audit.countBefore(new Date().toISOString()), 0);
  assert.equal(existsSync(join(artifacts, artifactRunId)), false);

  maintenance.close();
  audit.close();
  runs.close();
  rmSync(directory, { recursive: true, force: true });
});
