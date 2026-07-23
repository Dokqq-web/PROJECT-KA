import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlaywrightRunner } from "../dist/runners/playwright-runner.js";

test("advanced Playwright actions work together", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "qa-bot-browser-"));
  const uploadPath = join(directory, "upload.txt");
  writeFileSync(uploadPath, "pilot upload");
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

  const runner = new PlaywrightRunner({ artifactsDirectory: directory });
  const result = await runner.run({
    id: "ADVANCED-PILOT",
    name: "Расширенный браузерный пилот",
    platform: "web",
    baseUrl: "http://127.0.0.1:4174",
    steps: [
      { id: "open", action: "open", target: "/" },
      { id: "frame", action: "setFrame", target: "iframe" },
      { id: "frame-click", action: "click", target: "#frame-button" },
      { id: "frame-text", action: "assertText", target: "#frame-button", value: "Нажато" },
      { id: "main", action: "resetFrame" },
      { id: "upload", action: "uploadFile", target: "#file-upload", value: uploadPath },
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
