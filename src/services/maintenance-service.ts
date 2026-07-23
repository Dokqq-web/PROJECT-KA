import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { RunRepository } from "../repositories/run-repository.js";
import type { AuditService } from "../security/audit-service.js";

export interface CleanupResult {
  dryRun: boolean;
  cutoff: string;
  runs: number;
  auditEvents: number;
  artifactDirectories: number;
}

export class MaintenanceService {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly runs: RunRepository,
    private readonly audit: AuditService,
    private readonly artifactsDirectory = resolve("artifacts")
  ) {}

  start(retentionDays: number): void {
    if (!Number.isInteger(retentionDays) || retentionDays < 1) return;
    void this.cleanup(retentionDays).catch((error) => {
      console.error("Automatic cleanup failed:", error);
    });
    this.timer = setInterval(() => {
      void this.cleanup(retentionDays).catch((error) => {
        console.error("Automatic cleanup failed:", error);
      });
    }, 24 * 60 * 60 * 1_000);
    this.timer.unref();
  }

  async cleanup(retentionDays: number, dryRun = false): Promise<CleanupResult> {
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
      throw new Error("retentionDays должен быть целым числом от 1 до 3650");
    }
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const expiredRuns = this.runs.list().filter(
      (run) => run.status === "completed" && run.updatedAt < cutoff
    );
    const artifactDirectories = [
      ...new Set(
        expiredRuns
          .map((run) => run.result?.runId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    const auditEvents = this.audit.countBefore(cutoff);
    if (!dryRun) {
      for (const runId of artifactDirectories) {
        await this.removeArtifactDirectory(runId);
      }
      this.runs.deleteCompletedBefore(cutoff);
      this.audit.deleteBefore(cutoff);
    }
    return {
      dryRun,
      cutoff,
      runs: expiredRuns.length,
      auditEvents,
      artifactDirectories: artifactDirectories.length
    };
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async removeArtifactDirectory(runId: string): Promise<void> {
    const root = resolve(this.artifactsDirectory);
    const target = resolve(root, runId);
    if (!target.startsWith(`${root}${sep}`)) {
      throw new Error("Некорректный путь каталога артефактов");
    }
    await rm(target, { recursive: true, force: true });
  }
}
