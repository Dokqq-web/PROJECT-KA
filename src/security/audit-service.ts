import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Principal } from "./auth-service.js";

export interface AuditEvent {
  id: string;
  timestamp: string;
  principalId?: string;
  principalName?: string;
  role?: string;
  method: string;
  path: string;
  statusCode: number;
  remoteAddress?: string;
}

export interface AuditQuery {
  limit?: number;
  method?: string;
  statusCode?: number;
  principalId?: string;
  from?: string;
  to?: string;
}

export class AuditService {
  private readonly database: DatabaseSync;

  constructor(databasePath = resolve("data", "qa-bot.db")) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        principal_id TEXT,
        principal_name TEXT,
        role TEXT,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        remote_address TEXT
      );
      CREATE INDEX IF NOT EXISTS audit_events_timestamp_idx
      ON audit_events(timestamp DESC);
    `);
  }

  record(input: {
    principal?: Principal;
    method: string;
    path: string;
    statusCode: number;
    remoteAddress?: string;
  }): void {
    this.database
      .prepare(`
        INSERT INTO audit_events (
          id, timestamp, principal_id, principal_name, role, method, path,
          status_code, remote_address
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        new Date().toISOString(),
        input.principal?.id ?? null,
        input.principal?.name ?? null,
        input.principal?.role ?? null,
        input.method,
        input.path,
        input.statusCode,
        input.remoteAddress ?? null
      );
  }

  list(query: AuditQuery | number = {}): AuditEvent[] {
    const normalized = typeof query === "number" ? { limit: query } : query;
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (normalized.method) {
      conditions.push("method = ?");
      parameters.push(normalized.method.toUpperCase());
    }
    if (normalized.statusCode !== undefined) {
      conditions.push("status_code = ?");
      parameters.push(normalized.statusCode);
    }
    if (normalized.principalId) {
      conditions.push("principal_id = ?");
      parameters.push(normalized.principalId);
    }
    if (normalized.from) {
      conditions.push("timestamp >= ?");
      parameters.push(normalized.from);
    }
    if (normalized.to) {
      conditions.push("timestamp <= ?");
      parameters.push(normalized.to);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(Math.max(normalized.limit ?? 100, 1), 500);
    return this.database
      .prepare(`
        SELECT
          id,
          timestamp,
          principal_id AS principalId,
          principal_name AS principalName,
          role,
          method,
          path,
          status_code AS statusCode,
          remote_address AS remoteAddress
        FROM audit_events
        ${where}
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      .all(...parameters, limit) as unknown as AuditEvent[];
  }

  close(): void {
    this.database.close();
  }
}
