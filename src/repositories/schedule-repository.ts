export interface ScheduleRecord {
  id: string;
  name: string;
  testCaseId: string;
  targetType: "testCase" | "suite";
  targetId: string;
  scheduleType: "once" | "interval" | "cron";
  nextRunAt: string;
  repeatMinutes?: number;
  cronExpression?: string;
  timezone: string;
  overlapPolicy: "queue" | "skip";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunId?: string;
}

export interface ScheduleTriggerRecord {
  id: string;
  scheduleId: string;
  plannedAt: string;
  triggeredAt: string;
  status: "created" | "skipped" | "failed";
  runId?: string;
  message?: string;
}

export interface ScheduleRepository {
  create(record: ScheduleRecord): void;
  update(record: ScheduleRecord): void;
  get(id: string): ScheduleRecord | undefined;
  list(): ScheduleRecord[];
  due(now: string): ScheduleRecord[];
  createTrigger(record: ScheduleTriggerRecord): void;
  listTriggers(scheduleId?: string, limit?: number): ScheduleTriggerRecord[];
}
