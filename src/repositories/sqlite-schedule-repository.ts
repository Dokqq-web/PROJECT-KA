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
  target_type: string;
  target_id: string | null;
  schedule_type: string;
  cron_expression: string | null;
  timezone: string;
  overlap_policy: string;
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
      CREATE TABLE IF NOT EXISTS schedule_triggers (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        planned_at TEXT NOT NULL,
        triggered_at TEXT NOT NULL,
        status TEXT NOT NULL,
        run_id TEXT,
        message TEXT
      );
    `);
    addColumnIfMissing(this.database, "schedules", "target_type", "TEXT NOT NULL DEFAULT 'testCase'");
    addColumnIfMissing(this.database, "schedules", "target_id", "TEXT");
    addColumnIfMissing(this.database, "schedules", "schedule_type", "TEXT NOT NULL DEFAULT 'once'");
    addColumnIfMissing(this.database, "schedules", "cron_expression", "TEXT");
    addColumnIfMissing(this.database, "schedules", "timezone", "TEXT NOT NULL DEFAULT 'UTC'");
    addColumnIfMissing(this.database, "schedules", "overlap_policy", "TEXT NOT NULL DEFAULT 'queue'");
  }

  create(record: ScheduleRecord): void {
    this.database
      .prepare(`
        INSERT INTO schedules (
          id, name, test_case_id, next_run_at, repeat_minutes, enabled,
          created_at, updated_at, last_run_id, target_type, target_id,
          schedule_type, cron_expression, timezone, overlap_policy
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(...parameters(record));
  }

  update(record: ScheduleRecord): void {
    this.database
      .prepare(`
        UPDATE schedules
        SET name = ?, test_case_id = ?, next_run_at = ?, repeat_minutes = ?,
            enabled = ?, updated_at = ?, last_run_id = ?, target_type = ?,
            target_id = ?, schedule_type = ?, cron_expression = ?, timezone = ?,
            overlap_policy = ?
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
        record.targetType,
        record.targetId,
        record.scheduleType,
        record.cronExpression ?? null,
        record.timezone,
        record.overlapPolicy,
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

  createTrigger(record: import("./schedule-repository.js").ScheduleTriggerRecord): void {
    this.database.prepare(`
      INSERT INTO schedule_triggers (
        id, schedule_id, planned_at, triggered_at, status, run_id, message
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.scheduleId,
      record.plannedAt,
      record.triggeredAt,
      record.status,
      record.runId ?? null,
      record.message ?? null
    );
  }

  listTriggers(
    scheduleId?: string,
    limit = 100
  ): import("./schedule-repository.js").ScheduleTriggerRecord[] {
    const rows = scheduleId
      ? this.database.prepare(`
          SELECT * FROM schedule_triggers WHERE schedule_id = ?
          ORDER BY triggered_at DESC LIMIT ?
        `).all(scheduleId, limit)
      : this.database.prepare(`
          SELECT * FROM schedule_triggers ORDER BY triggered_at DESC LIMIT ?
        `).all(limit);
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      scheduleId: String(row.schedule_id),
      plannedAt: String(row.planned_at),
      triggeredAt: String(row.triggered_at),
      status: String(row.status) as "created" | "skipped" | "failed",
      runId: row.run_id ? String(row.run_id) : undefined,
      message: row.message ? String(row.message) : undefined
    }));
  }

  close(): void {
    this.database.close();
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
    ,
    record.targetType,
    record.targetId,
    record.scheduleType,
    record.cronExpression ?? null,
    record.timezone,
    record.overlapPolicy
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
    ,
    targetType: row.target_type === "suite" ? "suite" : "testCase",
    targetId: row.target_id ?? row.test_case_id,
    scheduleType:
      row.schedule_type === "cron"
        ? "cron"
        : row.repeat_minutes
          ? "interval"
          : "once",
    cronExpression: row.cron_expression ?? undefined,
    timezone: row.timezone || "UTC",
    overlapPolicy: row.overlap_policy === "skip" ? "skip" : "queue"
  };
}

function addColumnIfMissing(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
