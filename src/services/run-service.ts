import { randomUUID } from "node:crypto";
import type { TestCase, TestResult } from "../domain/test-case.js";
import type { TestRunner } from "../ports/test-runner.js";
import type { RunRepository } from "../repositories/run-repository.js";

export type RunStatus = "queued" | "running" | "completed";

export interface RunRecord {
  id: string;
  status: RunStatus;
  testCase: TestCase;
  createdAt: string;
  updatedAt: string;
  result?: TestResult;
  error?: string;
  cancelRequested?: boolean;
  cancelledAt?: string;
}

export class RunService {
  private readonly pending: string[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private activeCount = 0;

  constructor(
    private readonly runner: TestRunner,
    private readonly repository: RunRepository,
    private readonly maxConcurrency = 2,
    private readonly onCompleted?: (record: RunRecord) => void | Promise<void>
  ) {
    this.repository.recoverInterruptedRuns();
    this.pending.push(
      ...this.repository
        .list()
        .filter((record) => record.status === "queued")
        .map((record) => record.id)
    );
    this.pump();
  }

  create(testCase: TestCase): RunRecord {
    const timestamp = new Date().toISOString();
    const record: RunRecord = {
      id: randomUUID(),
      status: "queued",
      testCase,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.repository.create(record);

    this.pending.push(record.id);
    this.pump();
    return structuredClone(record);
  }

  list(): RunRecord[] {
    return this.repository.list();
  }

  get(id: string): RunRecord | undefined {
    return this.repository.get(id);
  }

  cancel(id: string): RunRecord | undefined {
    const record = this.repository.get(id);
    if (!record || record.status === "completed") return record;
    const timestamp = new Date().toISOString();
    record.cancelRequested = true;
    record.cancelledAt = timestamp;

    if (record.status === "queued") {
      record.status = "completed";
      record.error = "Запуск отменён пользователем";
      record.updatedAt = timestamp;
      this.repository.update(record);
      void this.notifyCompletion(record);
    } else {
      this.repository.update(record);
      this.controllers.get(id)?.abort();
    }
    return this.repository.get(id);
  }

  queueState(): { active: number; queued: number; limit: number } {
    return {
      active: this.activeCount,
      queued: this.repository.list().filter((run) => run.status === "queued").length,
      limit: this.maxConcurrency
    };
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrency && this.pending.length > 0) {
      const id = this.pending.shift()!;
      const record = this.repository.get(id);
      if (!record || record.status !== "queued") continue;
      this.activeCount += 1;
      void this.execute(id).finally(() => {
        this.activeCount -= 1;
        this.pump();
      });
    }
  }

  private async execute(id: string): Promise<void> {
    const record = this.repository.get(id);
    if (!record) return;

    record.status = "running";
    record.updatedAt = new Date().toISOString();
    this.repository.update(record);

    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      record.result = await this.runner.run(record.testCase, controller.signal);
    } catch (error) {
      record.error = controller.signal.aborted
        ? "Запуск отменён пользователем"
        : error instanceof Error
          ? error.message
          : String(error);
    } finally {
      this.controllers.delete(id);
      const latest = this.repository.get(id);
      record.cancelRequested = latest?.cancelRequested ?? record.cancelRequested;
      record.cancelledAt = latest?.cancelledAt ?? record.cancelledAt;
      record.status = "completed";
      record.updatedAt = new Date().toISOString();
      this.repository.update(record);
      await this.notifyCompletion(record);
    }
  }

  private async notifyCompletion(record: RunRecord): Promise<void> {
    try {
      await this.onCompleted?.(structuredClone(record));
    } catch (error) {
      console.error("Run completion hook failed:", error);
    }
  }
}
