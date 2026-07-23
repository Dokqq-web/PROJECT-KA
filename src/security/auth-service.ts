import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Role = "admin" | "editor" | "viewer";

export interface Principal {
  id: string;
  name: string;
  role: Role;
}

interface KeyRow {
  id: string;
  name: string;
  role: Role;
  key_hash: string;
  enabled: number;
}

export class AuthService {
  private readonly database: DatabaseSync;
  readonly required: boolean;

  constructor(databasePath = resolve("data", "qa-bot.db")) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
        key_hash TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
    `);

    const bootstrapKey = process.env.BOOTSTRAP_API_KEY;
    if (bootstrapKey) {
      this.ensureBootstrap(
        bootstrapKey,
        process.env.BOOTSTRAP_NAME ?? "Bootstrap admin",
        roleValue(process.env.BOOTSTRAP_ROLE) ?? "admin"
      );
    }
    this.required = this.countEnabledKeys() > 0;
  }

  authenticate(rawKey: string | undefined): Principal | undefined {
    if (!this.required) {
      return { id: "local-development", name: "Local development", role: "admin" };
    }
    if (!rawKey) return undefined;
    const hash = hashKey(rawKey);
    const rows = this.database
      .prepare("SELECT * FROM api_keys WHERE enabled = 1")
      .all() as unknown as KeyRow[];
    const row = rows.find((candidate) => safeEqual(candidate.key_hash, hash));
    if (!row) return undefined;
    this.database
      .prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
      .run(new Date().toISOString(), row.id);
    return { id: row.id, name: row.name, role: row.role };
  }

  createKey(name: string, role: Role): { id: string; key: string; role: Role } {
    const id = randomUUID();
    const key = `qabot_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
    this.database
      .prepare(`
        INSERT INTO api_keys (id, name, role, key_hash, enabled, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `)
      .run(id, name.trim() || "API key", role, hashKey(key), new Date().toISOString());
    return { id, key, role };
  }

  listKeys(): Array<{ id: string; name: string; role: Role; enabled: boolean }> {
    return (
      this.database
        .prepare("SELECT id, name, role, enabled FROM api_keys ORDER BY created_at")
        .all() as unknown as Array<{
        id: string;
        name: string;
        role: Role;
        enabled: number;
      }>
    ).map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
  }

  revokeKey(id: string): boolean {
    return Number(
      this.database
        .prepare("UPDATE api_keys SET enabled = 0 WHERE id = ?")
        .run(id).changes
    ) > 0;
  }

  close(): void {
    this.database.close();
  }

  private ensureBootstrap(key: string, name: string, role: Role): void {
    const hash = hashKey(key);
    const existing = this.database
      .prepare("SELECT id FROM api_keys WHERE key_hash = ?")
      .get(hash);
    if (!existing) {
      this.database
        .prepare(`
          INSERT INTO api_keys (id, name, role, key_hash, enabled, created_at)
          VALUES (?, ?, ?, ?, 1, ?)
        `)
        .run(randomUUID(), name, role, hash, new Date().toISOString());
    }
  }

  private countEnabledKeys(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM api_keys WHERE enabled = 1")
      .get() as unknown as { count: number };
    return Number(row.count);
  }
}

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function roleValue(value: unknown): Role | undefined {
  return value === "admin" || value === "editor" || value === "viewer"
    ? value
    : undefined;
}

export function canWrite(principal: Principal): boolean {
  return principal.role === "admin" || principal.role === "editor";
}
