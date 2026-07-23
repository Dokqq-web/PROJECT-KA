import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { AuthService } from "../dist/security/auth-service.js";
import { SecretVault } from "../dist/security/secret-vault.js";
import { AuditService } from "../dist/security/audit-service.js";

test("API keys are hashed and roles are enforced by identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "qa-bot-auth-"));
  const database = join(directory, "test.db");
  process.env.BOOTSTRAP_API_KEY = "bootstrap-test-value";
  const auth = new AuthService(database);

  assert.equal(auth.authenticate("bootstrap-test-value")?.role, "admin");
  assert.equal(auth.authenticate("wrong-key"), undefined);
  const viewer = auth.createKey("Reader", "viewer");
  assert.equal(auth.authenticate(viewer.key)?.role, "viewer");

  const databaseBytes = readFileSync(database);
  assert.equal(databaseBytes.includes(Buffer.from(viewer.key)), false);
  auth.close();
  delete process.env.BOOTSTRAP_API_KEY;
  rmSync(directory, { recursive: true, force: true });
});

test("vault encrypts values and enforces ownership", () => {
  const directory = mkdtempSync(join(tmpdir(), "qa-bot-vault-"));
  const database = join(directory, "test.db");
  process.env.SECRET_MASTER_KEY = randomBytes(32).toString("base64");
  const vault = new SecretVault(database);
  const secret = vault.create("CRM token", "plaintext-secret", "owner-1");

  assert.equal(vault.read(secret.id, "owner-1"), "plaintext-secret");
  assert.equal(vault.read(secret.id, "owner-2"), undefined);
  assert.equal(vault.remove(secret.id, "owner-2"), false);
  assert.equal(vault.read(secret.id, "owner-1"), "plaintext-secret");
  assert.equal(vault.remove(secret.id, "admin", true), true);
  assert.equal(
    readFileSync(database).includes(Buffer.from("plaintext-secret")),
    false
  );

  vault.close();
  delete process.env.SECRET_MASTER_KEY;
  rmSync(directory, { recursive: true, force: true });
});

test("audit supports operational filters", () => {
  const directory = mkdtempSync(join(tmpdir(), "qa-bot-audit-"));
  const database = join(directory, "test.db");
  const audit = new AuditService(database);
  audit.record({
    principal: { id: "editor-1", name: "Editor", role: "editor" },
    method: "POST",
    path: "/runs",
    statusCode: 202
  });
  audit.record({
    principal: { id: "viewer-1", name: "Viewer", role: "viewer" },
    method: "GET",
    path: "/runs",
    statusCode: 200
  });

  assert.equal(audit.list({ method: "post" }).length, 1);
  assert.equal(audit.list({ statusCode: 200 })[0]?.principalId, "viewer-1");
  assert.equal(audit.list({ principalId: "editor-1" })[0]?.path, "/runs");

  audit.close();
  rmSync(directory, { recursive: true, force: true });
});
