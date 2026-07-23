import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  TestSuiteRecord,
  TestSuiteRepository,
  TestSuiteRunRecord
} from "./test-suite-repository.js";

export class SqliteTestSuiteRepository implements TestSuiteRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath = resolve("data", "qa-bot.db")) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS test_suites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        test_case_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS test_suite_runs (
        id TEXT PRIMARY KEY,
        suite_id TEXT NOT NULL,
        run_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS test_suite_runs_created_idx
      ON test_suite_runs(created_at DESC);
    `);
  }

  createSuite(record: TestSuiteRecord): void {
    this.database.prepare(`
      INSERT INTO test_suites (id, name, test_case_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.name,
      JSON.stringify(record.testCaseIds),
      record.createdAt,
      record.updatedAt
    );
  }

  getSuite(id: string): TestSuiteRecord | undefined {
    const row = this.database.prepare("SELECT * FROM test_suites WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? suiteFromRow(row) : undefined;
  }

  listSuites(): TestSuiteRecord[] {
    return (this.database.prepare("SELECT * FROM test_suites ORDER BY updated_at DESC")
      .all() as Record<string, unknown>[]).map(suiteFromRow);
  }

  createRun(record: TestSuiteRunRecord): void {
    this.database.prepare(`
      INSERT INTO test_suite_runs (id, suite_id, run_ids_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(record.id, record.suiteId, JSON.stringify(record.runIds), record.createdAt);
  }

  getRun(id: string): TestSuiteRunRecord | undefined {
    const row = this.database.prepare("SELECT * FROM test_suite_runs WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? runFromRow(row) : undefined;
  }

  listRuns(): TestSuiteRunRecord[] {
    return (this.database.prepare("SELECT * FROM test_suite_runs ORDER BY created_at DESC")
      .all() as Record<string, unknown>[]).map(runFromRow);
  }
}

function suiteFromRow(row: Record<string, unknown>): TestSuiteRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    testCaseIds: JSON.parse(String(row.test_case_ids_json)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function runFromRow(row: Record<string, unknown>): TestSuiteRunRecord {
  return {
    id: String(row.id),
    suiteId: String(row.suite_id),
    runIds: JSON.parse(String(row.run_ids_json)),
    createdAt: String(row.created_at)
  };
}
