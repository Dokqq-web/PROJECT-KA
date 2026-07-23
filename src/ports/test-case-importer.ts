import type { TestCase } from "../domain/test-case.js";

export interface TestCaseImporter {
  import(externalId: string): Promise<TestCase>;
}

