export interface ScheduleRecord {
  id: string;
  name: string;
  testCaseId: string;
  nextRunAt: string;
  repeatMinutes?: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunId?: string;
}

export interface ScheduleRepository {
  create(record: ScheduleRecord): void;
  update(record: ScheduleRecord): void;
  get(id: string): ScheduleRecord | undefined;
  list(): ScheduleRecord[];
  due(now: string): ScheduleRecord[];
}

