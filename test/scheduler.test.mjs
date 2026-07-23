import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextCronOccurrence } from "../dist/services/cron-service.js";
import { SqliteScheduleRepository } from "../dist/repositories/sqlite-schedule-repository.js";

test("cron calculates interval and timezone-aware occurrences", () => {
  assert.equal(
    nextCronOccurrence(
      "*/15 * * * *",
      "UTC",
      new Date("2026-07-23T10:07:30.000Z")
    ).toISOString(),
    "2026-07-23T10:15:00.000Z"
  );
  assert.equal(
    nextCronOccurrence(
      "0 9 * * *",
      "Europe/Moscow",
      new Date("2026-07-23T05:30:00.000Z")
    ).toISOString(),
    "2026-07-23T06:00:00.000Z"
  );
  assert.throws(
    () => nextCronOccurrence("bad cron", "UTC", new Date()),
    /5 полей/
  );
});

test("schedule repository persists advanced schedule and trigger history", () => {
  const directory = mkdtempSync(join(tmpdir(), "qa-bot-scheduler-"));
  const repository = new SqliteScheduleRepository(join(directory, "test.db"));
  const timestamp = new Date().toISOString();
  repository.create({
    id: "schedule-1",
    name: "Nightly",
    testCaseId: "suite-1",
    targetType: "suite",
    targetId: "suite-1",
    scheduleType: "cron",
    nextRunAt: "2026-07-24T00:00:00.000Z",
    cronExpression: "0 3 * * *",
    timezone: "Europe/Moscow",
    overlapPolicy: "skip",
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  repository.createTrigger({
    id: "trigger-1",
    scheduleId: "schedule-1",
    plannedAt: timestamp,
    triggeredAt: timestamp,
    status: "skipped",
    message: "Previous run active"
  });

  const schedule = repository.get("schedule-1");
  assert.equal(schedule.targetType, "suite");
  assert.equal(schedule.cronExpression, "0 3 * * *");
  assert.equal(schedule.overlapPolicy, "skip");
  assert.equal(repository.listTriggers("schedule-1")[0].status, "skipped");

  repository.close();
  rmSync(directory, { recursive: true, force: true });
});
