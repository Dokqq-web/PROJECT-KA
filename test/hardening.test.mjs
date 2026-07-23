import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorageService } from "../dist/services/file-storage-service.js";
import { ReportService } from "../dist/services/report-service.js";
import { assertSafeExternalUrl } from "../dist/security/url-policy.js";

test("file storage uses opaque IDs and rejects path traversal", () => {
  const directory = mkdtempSync(join(tmpdir(), "qa-bot-files-"));
  const files = new FileStorageService(directory, 100);
  const created = files.create(
    "../../fixture.txt",
    Buffer.from("safe").toString("base64")
  );
  assert.match(created.id, /^[a-f0-9-]{36}-fixture\.txt$/);
  assert.equal(files.exists(created.id), true);
  assert.throws(() => files.resolve("../../etc/passwd"), /file ID/i);
  assert.throws(
    () => files.create("large.bin", Buffer.alloc(101).toString("base64")),
    /лимит/
  );
  rmSync(directory, { recursive: true, force: true });
});

test("outbound URL policy blocks private networks unless explicitly allowed", async () => {
  await assert.rejects(
    assertSafeExternalUrl("http://127.0.0.1/internal", {}),
    /запрещ/
  );
  const allowed = await assertSafeExternalUrl(
    "http://127.0.0.1/internal",
    { OUTBOUND_HOST_ALLOWLIST: "127.0.0.1" }
  );
  assert.equal(allowed.hostname, "127.0.0.1");
  await assert.rejects(
    assertSafeExternalUrl(
      "https://example.com",
      { OUTBOUND_HOST_ALLOWLIST: "company.example" }
    ),
    /allowlist/i
  );
});

test("HTML and JUnit reports escape user-controlled content", () => {
  const timestamp = new Date().toISOString();
  const run = {
    id: "run-report",
    status: "completed",
    testCase: {
      id: "REPORT",
      name: "<script>alert(1)</script>",
      platform: "web",
      steps: [{ id: "step<&", action: "wait", value: "0" }]
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    result: {
      runId: "result-report",
      testCaseId: "REPORT",
      status: "failed",
      startedAt: timestamp,
      finishedAt: timestamp,
      steps: [{
        stepId: "step<&",
        status: "failed",
        startedAt: timestamp,
        finishedAt: timestamp,
        error: "\"unsafe\" <value>"
      }]
    }
  };
  const reports = new ReportService();
  const html = reports.html(run);
  const junit = reports.junit(run);
  assert.equal(html.includes("<script>alert"), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(junit, /failures="1"/);
  assert.match(junit, /&lt;value&gt;/);
});
