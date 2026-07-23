import type { TestCase, TestResult } from "../domain/test-case.js";

export interface TestRunner {
  run(testCase: TestCase, signal?: AbortSignal): Promise<TestResult>;
}
