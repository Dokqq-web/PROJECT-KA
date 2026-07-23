import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RunRecord, RunStatus } from "../services/run-service.js";
import type { RunRepository } from "./run-repository.js";

interface RunRow {
  id: string;
  status: string;
  test_case_json: string;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  cancel_requested: number;
  cancelled_at: string | null;
}

export class SqliteRunRepository implements RunRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath = resolve("data", "qa-bot.db")) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed')),
        test_case_json TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS runs_created_at_idx
      ON runs(created_at DESC);
    `);
    addColumnIfMissing(this.database, "runs", "cancel_requested", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(this.database, "runs", "cancelled_at", "TEXT");
  }

  create(record: RunRecord): void {
    this.database
      .prepare(`
        INSERT INTO runs (
          id, status, test_case_json, result_json, error, created_at, updated_at,
          cancel_requested, cancelled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(...toParameters(record));
  }

  update(record: RunRecord): void {
    this.database
      .prepare(`
        UPDATE runs
        SET status = ?, test_case_json = ?, result_json = ?, error = ?, updated_at = ?,
            cancel_requested = ?, cancelled_at = ?
        WHERE id = ?
      `)
      .run(
        record.status,
        JSON.stringify(record.testCase),
        record.result ? JSON.stringify(record.result) : null,
        record.error ?? null,
        record.updatedAt,
        record.cancelRequested ? 1 : 0,
        record.cancelledAt ?? null,
        record.id
      );
  }

  get(id: string): RunRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(id) as unknown as RunRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  list(): RunRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM runs ORDER BY created_at DESC")
      .all() as unknown as RunRow[];
    return rows.map(fromRow);
  }

  recoverInterruptedRuns(): number {
    const timestamp = new Date().toISOString();
    const result = this.database
      .prepare(`
        UPDATE runs
        SET status = 'completed',
            error = 'Запуск был прерван перезапуском сервиса',
            updated_at = ?
        WHERE status = 'running'
      `)
      .run(timestamp);
    return Number(result.changes);
  }

  deleteCompletedBefore(timestamp: string): number {
    const result = this.database
      .prepare("DELETE FROM runs WHERE status = 'completed' AND updated_at < ?")
      .run(timestamp);
    return Number(result.changes);
  }

  close(): void {
    this.database.close();
  }
}

function toParameters(record: RunRecord): Array<string | number | null> {
  return [
    record.id,
    record.status,
    JSON.stringify(record.testCase),
    record.result ? JSON.stringify(record.result) : null,
    record.error ?? null,
    record.createdAt,
    record.updatedAt,
    record.cancelRequested ? 1 : 0,
    record.cancelledAt ?? null
  ];
}

function fromRow(row: RunRow): RunRecord {
  return {
    id: row.id,
    status: row.status as RunStatus,
    testCase: JSON.parse(row.test_case_json),
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    error: row.error ?? undefined,
    cancelRequested: Boolean(row.cancel_requested),
    cancelledAt: row.cancelled_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function addColumnIfMissing(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string
): void {
  const columns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as unknown as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
