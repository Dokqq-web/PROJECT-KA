import { randomUUID } from "node:crypto";
import type { TestCase } from "../domain/test-case.js";
import type {
  SavedTestCase,
  TestCaseRepository
} from "../repositories/test-case-repository.js";

export class TestCaseService {
  constructor(private readonly repository: TestCaseRepository) {}

  create(testCase: TestCase): SavedTestCase {
    const timestamp = new Date().toISOString();
    const record: SavedTestCase = {
      id: randomUUID(),
      testCase: { ...structuredClone(testCase), id: `CASE-${randomUUID()}` },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.repository.create(record);
    return record;
  }

  update(id: string, testCase: TestCase): SavedTestCase | undefined {
    const existing = this.repository.get(id);
    if (!existing) return undefined;

    existing.testCase = {
      ...structuredClone(testCase),
      id: existing.testCase.id
    };
    existing.updatedAt = new Date().toISOString();
    this.repository.update(existing);
    return existing;
  }

  copy(id: string): SavedTestCase | undefined {
    const existing = this.repository.get(id);
    if (!existing) return undefined;
    return this.create({
      ...structuredClone(existing.testCase),
      name: `${existing.testCase.name} — копия`
    });
  }

  get(id: string): SavedTestCase | undefined {
    return this.repository.get(id);
  }

  list(): SavedTestCase[] {
    return this.repository.list();
  }
}

