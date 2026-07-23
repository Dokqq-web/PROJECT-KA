import { randomUUID } from "node:crypto";
import type {
  ScheduleRecord,
  ScheduleRepository
} from "../repositories/schedule-repository.js";
import { RunService } from "./run-service.js";
import { TestCaseService } from "./test-case-service.js";
import { TestSuiteService } from "./test-suite-service.js";
import { nextCronOccurrence } from "./cron-service.js";

export class ScheduleService {
  private readonly timer: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly repository: ScheduleRepository,
    private readonly testCases: TestCaseService,
    private readonly runs: RunService,
    private readonly suites?: TestSuiteService
  ) {
    this.timer = setInterval(() => void this.tick(), 1_000);
    this.timer.unref();
    void this.tick();
  }

  create(input: {
    name: string;
    testCaseId?: string;
    targetType?: "testCase" | "suite";
    targetId?: string;
    runAt?: string;
    repeatMinutes?: number;
    cronExpression?: string;
    timezone?: string;
    overlapPolicy?: "queue" | "skip";
  }): ScheduleRecord {
    const targetType = input.targetType ?? "testCase";
    const targetId = input.targetId ?? input.testCaseId;
    if (!targetId) throw new Error("Цель расписания обязательна");
    if (targetType === "testCase" && !this.testCases.get(targetId)) {
      throw new Error("Шаблон тест-кейса не найден");
    }
    if (targetType === "suite" && !this.suites?.get(targetId)) {
      throw new Error("Набор тестов не найден");
    }
    const timezone = input.timezone || "UTC";
    let scheduleType: "once" | "interval" | "cron";
    let nextRunAt: string;
    if (input.cronExpression) {
      scheduleType = "cron";
      nextRunAt = nextCronOccurrence(
        input.cronExpression,
        timezone,
        new Date()
      ).toISOString();
    } else {
      const runAt = new Date(input.runAt ?? "");
      if (Number.isNaN(runAt.getTime())) throw new Error("Некорректная дата запуска");
      nextRunAt = runAt.toISOString();
      scheduleType = input.repeatMinutes ? "interval" : "once";
    }
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
      testCaseId: targetId,
      targetType,
      targetId,
      scheduleType,
      nextRunAt,
      repeatMinutes: input.repeatMinutes,
      cronExpression: input.cronExpression,
      timezone,
      overlapPolicy: input.overlapPolicy ?? "queue",
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

  triggers(scheduleId?: string) {
    return this.repository.listTriggers(scheduleId);
  }

  cancel(id: string): ScheduleRecord | undefined {
    const record = this.repository.get(id);
    if (!record) return undefined;
    record.enabled = false;
    record.updatedAt = new Date().toISOString();
    this.repository.update(record);
    return record;
  }

  close(): void {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date();
      for (const schedule of this.repository.due(now.toISOString())) {
        const plannedAt = schedule.nextRunAt;
        const targetExists =
          schedule.targetType === "suite"
            ? Boolean(this.suites?.get(schedule.targetId))
            : Boolean(this.testCases.get(schedule.targetId));
        if (!targetExists) {
          schedule.enabled = false;
          schedule.updatedAt = now.toISOString();
          this.repository.update(schedule);
          this.recordTrigger(schedule, plannedAt, "failed", undefined, "Цель не найдена");
          continue;
        }
        if (schedule.overlapPolicy === "skip" && this.isPreviousActive(schedule)) {
          this.recordTrigger(
            schedule,
            plannedAt,
            "skipped",
            undefined,
            "Предыдущий запуск ещё выполняется"
          );
          this.advance(schedule, now);
          this.repository.update(schedule);
          continue;
        }
        try {
          const runId =
            schedule.targetType === "suite"
              ? this.suites!.run(schedule.targetId).id
              : this.runs.create(this.testCases.get(schedule.targetId)!.testCase).id;
          schedule.lastRunId = runId;
          this.recordTrigger(schedule, plannedAt, "created", runId);
        } catch (error) {
          this.recordTrigger(
            schedule,
            plannedAt,
            "failed",
            undefined,
            error instanceof Error ? error.message : String(error)
          );
        }
        schedule.updatedAt = now.toISOString();
        this.advance(schedule, now);
        this.repository.update(schedule);
      }
    } finally {
      this.ticking = false;
    }
  }

  private isPreviousActive(schedule: ScheduleRecord): boolean {
    if (!schedule.lastRunId) return false;
    if (schedule.targetType === "suite") {
      const previous = this.suites?.getRun(schedule.lastRunId);
      return previous?.status === "queued" || previous?.status === "running";
    }
    const previous = this.runs.get(schedule.lastRunId);
    return Boolean(previous && previous.status !== "completed");
  }

  private advance(schedule: ScheduleRecord, now: Date): void {
    if (schedule.scheduleType === "cron" && schedule.cronExpression) {
      schedule.nextRunAt = nextCronOccurrence(
        schedule.cronExpression,
        schedule.timezone,
        now
      ).toISOString();
    } else if (schedule.scheduleType === "interval" && schedule.repeatMinutes) {
      let next = new Date(schedule.nextRunAt);
      do {
        next = new Date(next.getTime() + schedule.repeatMinutes * 60_000);
      } while (next <= now);
      schedule.nextRunAt = next.toISOString();
    } else {
      schedule.enabled = false;
    }
    schedule.updatedAt = now.toISOString();
  }

  private recordTrigger(
    schedule: ScheduleRecord,
    plannedAt: string,
    status: "created" | "skipped" | "failed",
    runId?: string,
    message?: string
  ): void {
    this.repository.createTrigger({
      id: randomUUID(),
      scheduleId: schedule.id,
      plannedAt,
      triggeredAt: new Date().toISOString(),
      status,
      runId,
      message
    });
  }
}
