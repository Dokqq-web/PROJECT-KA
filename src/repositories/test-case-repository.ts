import type { TestCase } from "../domain/test-case.js";

export interface SavedTestCase {
  id: string;
  testCase: TestCase;
  createdAt: string;
  updatedAt: string;
}

export interface TestCaseRepository {
  create(record: SavedTestCase): void;
  update(record: SavedTestCase): void;
  get(id: string): SavedTestCase | undefined;
  list(): SavedTestCase[];
}

