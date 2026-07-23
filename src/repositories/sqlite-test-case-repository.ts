import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  SavedTestCase,
  TestCaseRepository
} from "./test-case-repository.js";

interface TestCaseRow {
  id: string;
  test_case_json: string;
  created_at: string;
  updated_at: string;
}

export class SqliteTestCaseRepository implements TestCaseRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath = resolve("data", "qa-bot.db")) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS test_cases (
        id TEXT PRIMARY KEY,
        test_case_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS test_cases_updated_at_idx
      ON test_cases(updated_at DESC);
    `);
  }

  create(record: SavedTestCase): void {
    this.database
      .prepare(`
        INSERT INTO test_cases (id, test_case_json, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(
        record.id,
        JSON.stringify(record.testCase),
        record.createdAt,
        record.updatedAt
      );
  }

  update(record: SavedTestCase): void {
    this.database
      .prepare(`
        UPDATE test_cases
        SET test_case_json = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(JSON.stringify(record.testCase), record.updatedAt, record.id);
  }

  get(id: string): SavedTestCase | undefined {
    const row = this.database
      .prepare("SELECT * FROM test_cases WHERE id = ?")
      .get(id) as unknown as TestCaseRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  list(): SavedTestCase[] {
    const rows = this.database
      .prepare("SELECT * FROM test_cases ORDER BY updated_at DESC")
      .all() as unknown as TestCaseRow[];
    return rows.map(fromRow);
  }
}

function fromRow(row: TestCaseRow): SavedTestCase {
  return {
    id: row.id,
    testCase: JSON.parse(row.test_case_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

