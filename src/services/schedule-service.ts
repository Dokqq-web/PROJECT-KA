import { randomUUID } from "node:crypto";
import type {
  ScheduleRecord,
  ScheduleRepository
} from "../repositories/schedule-repository.js";
import { RunService } from "./run-service.js";
import { TestCaseService } from "./test-case-service.js";

export class ScheduleService {
  private readonly timer: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly repository: ScheduleRepository,
    private readonly testCases: TestCaseService,
    private readonly runs: RunService
  ) {
    this.timer = setInterval(() => void this.tick(), 1_000);
    this.timer.unref();
    void this.tick();
  }

  create(input: {
    name: string;
    testCaseId: string;
    runAt: string;
    repeatMinutes?: number;
  }): ScheduleRecord {
    if (!this.testCases.get(input.testCaseId)) {
      throw new Error("Шаблон тест-кейса не найден");
    }
    const runAt = new Date(input.runAt);
    if (Number.isNaN(runAt.getTime())) throw new Error("Некорректная дата запуска");
    if (
      input.repeatMinutes !== undefined &&
      (!Number.isInteger(input.repeatMinutes) || input.repeatMinutes < 1)
    ) {
      throw new Error("Интервал повтора должен быть целым числом от 1 минуты");
    }
    const timestamp = new Date().toISOString();
    const record: ScheduleRecord = {
      id: randomUUID(),
      name: input.name.trim() || "Запланированный тест",
      testCaseId: input.testCaseId,
      nextRunAt: runAt.toISOString(),
      repeatMinutes: input.repeatMinutes,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.repository.create(record);
    void this.tick();
    return record;
  }

  list(): ScheduleRecord[] {
    return this.repository.list();
  }

  cancel(id: string): ScheduleRecord | undefined {
    const record = this.repository.get(id);
    if (!record) return undefined;
    record.enabled = false;
    record.updatedAt = new Date().toISOString();
    this.repository.update(record);
    return record;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date();
      for (const schedule of this.repository.due(now.toISOString())) {
        const saved = this.testCases.get(schedule.testCaseId);
        if (!saved) {
          schedule.enabled = false;
          schedule.updatedAt = now.toISOString();
          this.repository.update(schedule);
          continue;
        }
        const run = this.runs.create(saved.testCase);
        schedule.lastRunId = run.id;
        schedule.updatedAt = now.toISOString();
        if (schedule.repeatMinutes) {
          let next = new Date(schedule.nextRunAt);
          do {
            next = new Date(next.getTime() + schedule.repeatMinutes * 60_000);
          } while (next <= now);
          schedule.nextRunAt = next.toISOString();
        } else {
          schedule.enabled = false;
        }
        this.repository.update(schedule);
      }
    } finally {
      this.ticking = false;
    }
  }
}

