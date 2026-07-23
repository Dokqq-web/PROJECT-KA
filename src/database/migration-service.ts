import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "baseline schema registry",
    sql: "SELECT 1;"
  },
  {
    version: 2,
    name: "operational lookup indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS runs_status_updated_idx
      ON runs(status, updated_at);
      CREATE INDEX IF NOT EXISTS audit_events_status_idx
      ON audit_events(status_code, timestamp DESC);
      CREATE INDEX IF NOT EXISTS schedules_enabled_next_idx
      ON schedules(enabled, next_run_at);
    `
  },
  {
    version: 3,
    name: "scheduler trigger indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS schedule_triggers_schedule_idx
      ON schedule_triggers(schedule_id, triggered_at DESC);
      CREATE INDEX IF NOT EXISTS schedules_target_idx
      ON schedules(target_type, target_id);
    `
  }
];

export interface MigrationStatus {
  currentVersion: number;
  latestVersion: number;
  pending: Array<{ version: number; name: string }>;
}

export class MigrationService {
  private readonly database: DatabaseSync;

  constructor(databasePath = resolve("data", "qa-bot.db")) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  }

  apply(): MigrationStatus {
    const applied = new Set(
      (this.database.prepare("SELECT version FROM schema_migrations").all() as Array<{
        version: number;
      }>).map((row) => row.version)
    );
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(migration.sql);
        this.database.prepare(`
          INSERT INTO schema_migrations (version, name, applied_at)
          VALUES (?, ?, ?)
        `).run(migration.version, migration.name, new Date().toISOString());
        this.database.exec(`PRAGMA user_version = ${migration.version}`);
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw new Error(
          `Не удалось применить миграцию ${migration.version} (${migration.name}): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    return this.status();
  }

  status(): MigrationStatus {
    const row = this.database
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { version: number };
    const currentVersion = Number(row.version);
    return {
      currentVersion,
      latestVersion: migrations.at(-1)?.version ?? 0,
      pending: migrations
        .filter((migration) => migration.version > currentVersion)
        .map(({ version, name }) => ({ version, name }))
    };
  }

  close(): void {
    this.database.close();
  }
}
