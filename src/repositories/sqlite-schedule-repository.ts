import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ScheduleRecord,
  ScheduleRepository
} from "./schedule-repository.js";

interface ScheduleRow {
  id: string;
  name: string;
  test_case_id: string;
  next_run_at: string;
  repeat_minutes: number | null;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_run_id: string | null;
}

export class SqliteScheduleRepository implements ScheduleRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath = resolve("data", "qa-bot.db")) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        test_case_id TEXT NOT NULL,
        next_run_at TEXT NOT NULL,
        repeat_minutes INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_id TEXT
      );
      CREATE INDEX IF NOT EXISTS schedules_due_idx
      ON schedules(enabled, next_run_at);
    `);
  }

  create(record: ScheduleRecord): void {
    this.database
      .prepare(`
        INSERT INTO schedules (
          id, name, test_case_id, next_run_at, repeat_minutes, enabled,
          created_at, updated_at, last_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(...parameters(record));
  }

  update(record: ScheduleRecord): void {
    this.database
      .prepare(`
        UPDATE schedules
        SET name = ?, test_case_id = ?, next_run_at = ?, repeat_minutes = ?,
            enabled = ?, updated_at = ?, last_run_id = ?
        WHERE id = ?
      `)
      .run(
        record.name,
        record.testCaseId,
        record.nextRunAt,
        record.repeatMinutes ?? null,
        record.enabled ? 1 : 0,
        record.updatedAt,
        record.lastRunId ?? null,
        record.id
      );
  }

  get(id: string): ScheduleRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM schedules WHERE id = ?")
      .get(id) as unknown as ScheduleRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  list(): ScheduleRecord[] {
    return (
      this.database
        .prepare("SELECT * FROM schedules ORDER BY next_run_at ASC")
        .all() as unknown as ScheduleRow[]
    ).map(fromRow);
  }

  due(now: string): ScheduleRecord[] {
    return (
      this.database
        .prepare(`
          SELECT * FROM schedules
          WHERE enabled = 1 AND next_run_at <= ?
          ORDER BY next_run_at ASC
        `)
        .all(now) as unknown as ScheduleRow[]
    ).map(fromRow);
  }
}

function parameters(record: ScheduleRecord): Array<string | number | null> {
  return [
    record.id,
    record.name,
    record.testCaseId,
    record.nextRunAt,
    record.repeatMinutes ?? null,
    record.enabled ? 1 : 0,
    record.createdAt,
    record.updatedAt,
    record.lastRunId ?? null
  ];
}

function fromRow(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id,
    name: row.name,
    testCaseId: row.test_case_id,
    nextRunAt: row.next_run_at,
    repeatMinutes: row.repeat_minutes ?? undefined,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunId: row.last_run_id ?? undefined
  };
}

