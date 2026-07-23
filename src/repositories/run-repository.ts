import type { RunRecord } from "../services/run-service.js";

export interface RunRepository {
  create(record: RunRecord): void;
  update(record: RunRecord): void;
  get(id: string): RunRecord | undefined;
  list(): RunRecord[];
  recoverInterruptedRuns(): number;
  deleteCompletedBefore(timestamp: string): number;
}
