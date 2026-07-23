import test from "node:test";
import assert from "node:assert/strict";
import { PlatformRunner } from "../dist/runners/platform-runner.js";
import { TestCaseImportService } from "../dist/services/test-case-import-service.js";

test("compiled application modules load", () => {
  assert.equal(typeof PlatformRunner, "function");
  assert.equal(typeof TestCaseImportService, "function");
});
