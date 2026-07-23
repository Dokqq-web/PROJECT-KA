import type { TestCase, TestResult } from "../domain/test-case.js";
import type { TestRunner } from "../ports/test-runner.js";

export class PlatformRunner implements TestRunner {
  constructor(
    private readonly web: TestRunner,
    private readonly mobile: TestRunner
  ) {}

  run(testCase: TestCase, signal?: AbortSignal): Promise<TestResult> {
    return testCase.platform === "web"
      ? this.web.run(testCase, signal)
      : this.mobile.run(testCase, signal);
  }
}

