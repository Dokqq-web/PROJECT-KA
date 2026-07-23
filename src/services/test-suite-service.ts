import { randomUUID } from "node:crypto";
import type {
  TestSuiteRecord,
  TestSuiteRepository,
  TestSuiteRunRecord
} from "../repositories/test-suite-repository.js";
import type { RunRecord, RunService } from "./run-service.js";
import type { TestCaseService } from "./test-case-service.js";

export interface TestSuiteRunView extends TestSuiteRunRecord {
  status: "queued" | "running" | "passed" | "failed";
  runs: RunRecord[];
}

export class TestSuiteService {
  constructor(
    private readonly repository: TestSuiteRepository,
    private readonly testCases: TestCaseService,
    private readonly runs: RunService
  ) {}

  create(name: string, testCaseIds: string[]): TestSuiteRecord {
    const values = this.validatedValues(name, testCaseIds);
    const timestamp = new Date().toISOString();
    const record = {
      id: randomUUID(),
      ...values,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.repository.createSuite(record);
    return record;
  }

  list(): TestSuiteRecord[] {
    return this.repository.listSuites();
  }

  get(id: string): TestSuiteRecord | undefined {
    return this.repository.getSuite(id);
  }

  update(
    id: string,
    name: string,
    testCaseIds: string[]
  ): TestSuiteRecord | undefined {
    const existing = this.repository.getSuite(id);
    if (!existing) return undefined;
    const record = {
      ...existing,
      ...this.validatedValues(name, testCaseIds),
      updatedAt: new Date().toISOString()
    };
    this.repository.updateSuite(record);
    return record;
  }

  delete(id: string): boolean {
    return this.repository.deleteSuite(id);
  }

  run(id: string): TestSuiteRunView {
    const suite = this.repository.getSuite(id);
    if (!suite) throw new Error("Набор тестов не найден");
    const runIds = suite.testCaseIds.map((testCaseId) => {
      const saved = this.testCases.get(testCaseId);
      if (!saved) throw new Error(`Тест-кейс не найден: ${testCaseId}`);
      return this.runs.create(saved.testCase).id;
    });
    const record: TestSuiteRunRecord = {
      id: randomUUID(),
      suiteId: id,
      runIds,
      createdAt: new Date().toISOString()
    };
    this.repository.createRun(record);
    return this.view(record);
  }

  getRun(id: string): TestSuiteRunView | undefined {
    const record = this.repository.getRun(id);
    return record ? this.view(record) : undefined;
  }

  retryFailed(id: string): TestSuiteRunView {
    const previous = this.getRun(id);
    if (!previous) throw new Error("Запуск набора не найден");
    const failed = previous.runs.filter(
      (run) => run.error || run.result?.status === "failed"
    );
    if (failed.length === 0) throw new Error("В наборе нет упавших тестов");
    const record: TestSuiteRunRecord = {
      id: randomUUID(),
      suiteId: previous.suiteId,
      runIds: failed.map((run) => this.runs.create(run.testCase).id),
      createdAt: new Date().toISOString()
    };
    this.repository.createRun(record);
    return this.view(record);
  }

  listRuns(): TestSuiteRunView[] {
    return this.repository.listRuns().map((record) => this.view(record));
  }

  private view(record: TestSuiteRunRecord): TestSuiteRunView {
    const runs = record.runIds.flatMap((id) => {
      const run = this.runs.get(id);
      return run ? [run] : [];
    });
    const status = runs.some((run) => run.status === "running")
      ? "running"
      : runs.some((run) => run.status === "queued")
        ? "queued"
        : runs.some((run) => run.error || run.result?.status === "failed")
          ? "failed"
          : "passed";
    return { ...record, status, runs };
  }

  private validatedValues(
    name: string,
    testCaseIds: string[]
  ): Pick<TestSuiteRecord, "name" | "testCaseIds"> {
    const uniqueIds = [...new Set(testCaseIds)];
    if (!name.trim()) throw new Error("Название набора обязательно");
    if (uniqueIds.length === 0) throw new Error("Добавьте хотя бы один тест-кейс");
    for (const id of uniqueIds) {
      if (!this.testCases.get(id)) throw new Error(`Тест-кейс не найден: ${id}`);
    }
    return { name: name.trim(), testCaseIds: uniqueIds };
  }
}
