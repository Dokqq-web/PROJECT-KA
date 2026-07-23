import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlaywrightRunner } from "../dist/runners/playwright-runner.js";
import { FileStorageService } from "../dist/services/file-storage-service.js";

test("advanced Playwright actions work together", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "qa-bot-browser-"));
  const uploadsDirectory = join(directory, "uploads");
  const files = new FileStorageService(uploadsDirectory);
  const uploaded = files.create(
    "upload.txt",
    Buffer.from("pilot upload").toString("base64")
  );
  const server = spawn(process.execPath, ["demo/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, DEMO_PORT: "4174" },
    stdio: "ignore"
  });
  context.after(async () => {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  await waitForUrl("http://127.0.0.1:4174");

  const runner = new PlaywrightRunner({
    artifactsDirectory: directory,
    uploadsDirectory
  });
  const previousBaseline = process.env.BASELINE_DIRECTORY;
  const previousUpdate = process.env.UPDATE_SNAPSHOTS;
  process.env.BASELINE_DIRECTORY = join(directory, "baselines");
  process.env.UPDATE_SNAPSHOTS = "true";
  context.after(() => {
    if (previousBaseline === undefined) delete process.env.BASELINE_DIRECTORY;
    else process.env.BASELINE_DIRECTORY = previousBaseline;
    if (previousUpdate === undefined) delete process.env.UPDATE_SNAPSHOTS;
    else process.env.UPDATE_SNAPSHOTS = previousUpdate;
  });
  const result = await runner.run({
    id: "ADVANCED-PILOT",
    name: "Расширенный браузерный пилот",
    platform: "web",
    baseUrl: "http://127.0.0.1:4174",
    steps: [
      { id: "open", action: "open", target: "/" },
      { id: "url", action: "assertUrl", value: "127.0.0.1:4174" },
      { id: "fill-extra", action: "fill", target: "[name=email]", value: "qa@example.test" },
      { id: "press", action: "press", target: "[name=email]", value: "End" },
      { id: "value", action: "assertValue", target: "[name=email]", value: "qa@example.test" },
      { id: "hover", action: "hover", target: "#download-link" },
      { id: "check", action: "check", target: "#terms-checkbox" },
      { id: "uncheck", action: "uncheck", target: "#terms-checkbox" },
      { id: "count", action: "assertCount", target: "#count-items li", value: "2" },
      { id: "attribute", action: "assertAttribute", target: "[data-kind=pilot]", value: "data-kind=pilot" },
      { id: "visual", action: "assertScreenshot", target: "#count-items", value: "count-items.png" },
      { id: "frame", action: "setFrame", target: "iframe" },
      { id: "frame-click", action: "click", target: "#frame-button" },
      { id: "frame-text", action: "assertText", target: "#frame-button", value: "Нажато" },
      { id: "main", action: "resetFrame" },
      { id: "upload", action: "uploadFile", target: "#file-upload", value: uploaded.id },
      { id: "mock", action: "mockRoute", target: "**/api/profile", value: "{\"name\":\"Pilot\"}" },
      { id: "profile", action: "click", target: "#load-profile" },
      { id: "profile-text", action: "assertText", target: "#profile-result", value: "Pilot" },
      { id: "download", action: "download", target: "#download-link", value: "report.txt" },
      { id: "shot", action: "screenshot", value: "pilot.png" },
      { id: "tab", action: "clickNewTab", target: "#new-tab-link" },
      { id: "tab-ready", action: "assertVisible", target: "#tab-ready" }
    ]
  });

  assert.equal(result.status, "passed");
  const artifacts = result.steps.flatMap((step) => step.artifacts ?? []);
  assert.ok(artifacts.some((path) => path.endsWith("report.txt") && existsSync(path)));
  assert.ok(artifacts.some((path) => path.endsWith("pilot.png") && existsSync(path)));

  process.env.UPDATE_SNAPSHOTS = "false";
  const visualResult = await runner.run({
    id: "ADVANCED-PILOT",
    name: "Visual regression",
    platform: "web",
    baseUrl: "http://127.0.0.1:4174",
    steps: [
      { id: "open", action: "open", target: "/" },
      { id: "visual", action: "assertScreenshot", target: "#count-items", value: "count-items.png" }
    ]
  });
  assert.equal(visualResult.status, "passed");

  const failedResult = await runner.run({
    id: "TRACE-PILOT",
    name: "Trace on failure",
    platform: "web",
    baseUrl: "http://127.0.0.1:4174",
    steps: [
      { id: "open", action: "open", target: "/" },
      { id: "fail", action: "assertText", target: "h1", value: "missing text" }
    ]
  });
  assert.equal(failedResult.status, "failed");
  const failureArtifacts = failedResult.steps.flatMap((step) => step.artifacts ?? []);
  assert.ok(failureArtifacts.some((path) => path.endsWith("trace.zip") && existsSync(path)));
});

async function waitForUrl(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The demo server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Demo server startup timed out");
}
