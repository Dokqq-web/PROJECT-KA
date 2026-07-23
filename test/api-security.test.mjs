import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

test("HTTP API enforces roles, secret ownership and audit filters", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "qa-bot-api-"));
  const port = await freePort();
  const bootstrapKey = "api-test-bootstrap";
  const child = spawn(process.execPath, ["dist/api/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(port),
      DATABASE_PATH: join(directory, "test.db"),
      BOOTSTRAP_API_KEY: bootstrapKey,
      SECRET_MASTER_KEY: randomBytes(32).toString("base64")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  context.after(async () => {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(directory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child, () => logs);
  const adminHeaders = headers(bootstrapKey);
  const editorOne = await createApiKey(baseUrl, adminHeaders, "Editor one", "editor");
  const editorTwo = await createApiKey(baseUrl, adminHeaders, "Editor two", "editor");
  const viewer = await createApiKey(baseUrl, adminHeaders, "Viewer", "viewer");

  const forbiddenRun = await request(baseUrl, "/runs", {
    method: "POST",
    headers: headers(viewer.key),
    body: JSON.stringify({})
  });
  assert.equal(forbiddenRun.status, 403);

  const created = await request(baseUrl, "/secrets", {
    method: "POST",
    headers: headers(editorOne.key),
    body: JSON.stringify({ name: "Owned token", value: "never-return-this" })
  });
  assert.equal(created.status, 201);

  const deniedRemoval = await request(
    baseUrl,
    `/secrets/${created.body.id}/remove`,
    { method: "POST", headers: headers(editorTwo.key) }
  );
  assert.equal(deniedRemoval.status, 404);
  assert.equal(deniedRemoval.body.removed, false);

  const ownerSecrets = await request(baseUrl, "/secrets", {
    headers: headers(editorOne.key)
  });
  assert.equal(ownerSecrets.body.length, 1);

  const audit = await request(baseUrl, "/audit?method=POST&status=404", {
    headers: adminHeaders
  });
  assert.equal(audit.status, 200);
  assert.ok(
    audit.body.some((event) =>
      event.path === `/secrets/${created.body.id}/remove`
    )
  );
  assert.equal(JSON.stringify(audit.body).includes("never-return-this"), false);

  const adminRemoval = await request(
    baseUrl,
    `/secrets/${created.body.id}/remove`,
    { method: "POST", headers: adminHeaders }
  );
  assert.equal(adminRemoval.status, 200);
});

async function createApiKey(baseUrl, adminHeaders, name, role) {
  const response = await request(baseUrl, "/auth/keys", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name, role })
  });
  assert.equal(response.status, 201);
  return response.body;
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { status: response.status, body: await response.json() };
}

function headers(key) {
  return {
    "content-type": "application/json",
    "x-api-key": key
  };
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl, child, logs) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`API exited before startup:\n${logs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API startup timed out:\n${logs()}`);
}
