import type { RunRecord } from "./run-service.js";

export interface NotificationStatus {
  webhookConfigured: boolean;
  telegramConfigured: boolean;
}

type FetchLike = typeof fetch;

export class NotificationService {
  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly fetcher: FetchLike = fetch
  ) {}

  status(): NotificationStatus {
    return {
      webhookConfigured: Boolean(this.environment.NOTIFICATION_WEBHOOK_URL),
      telegramConfigured: Boolean(
        this.environment.TELEGRAM_BOT_TOKEN &&
        this.environment.TELEGRAM_CHAT_ID
      )
    };
  }

  async notifyRunCompleted(run: RunRecord): Promise<void> {
    await this.deliver(run);
  }

  async sendTest(): Promise<{ attempted: number; delivered: number }> {
    const sample = sampleRun();
    return this.deliver(sample);
  }

  private async deliver(
    run: RunRecord
  ): Promise<{ attempted: number; delivered: number }> {
    const payload = runPayload(run);
    const tasks: Promise<void>[] = [];
    const webhookUrl = this.environment.NOTIFICATION_WEBHOOK_URL;
    if (webhookUrl) {
      tasks.push(this.postJson(webhookUrl, payload));
    }
    const token = this.environment.TELEGRAM_BOT_TOKEN;
    const chatId = this.environment.TELEGRAM_CHAT_ID;
    if (token && chatId) {
      tasks.push(this.postJson(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: chatId,
          text: telegramText(run),
          disable_web_page_preview: true
        }
      ));
    }
    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Notification delivery failed:", result.reason);
      }
    }
    return {
      attempted: results.length,
      delivered: results.filter((result) => result.status === "fulfilled").length
    };
  }

  private async postJson(url: string, body: unknown): Promise<void> {
    const response = await this.fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
  }
}

function sampleRun(): RunRecord {
  const timestamp = new Date().toISOString();
  return {
    id: "notification-test",
    status: "completed",
    testCase: {
      id: "NOTIFICATION-TEST",
      name: "Проверка уведомлений",
      platform: "web",
      steps: [{ id: "1", action: "wait", value: "0" }]
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    result: {
      runId: "notification-test",
      testCaseId: "NOTIFICATION-TEST",
      status: "passed",
      startedAt: timestamp,
      finishedAt: timestamp,
      steps: []
    }
  };
}

function runPayload(run: RunRecord): Record<string, unknown> {
  return {
    event: "test_run.completed",
    runId: run.id,
    testCaseId: run.testCase.id,
    testCaseName: run.testCase.name,
    platform: run.testCase.platform,
    status: run.error ? "failed" : run.result?.status ?? "failed",
    error: run.error,
    createdAt: run.createdAt,
    finishedAt: run.updatedAt
  };
}

function telegramText(run: RunRecord): string {
  const status = run.error || run.result?.status === "failed" ? "FAILED ❌" : "PASSED ✅";
  return [
    `QA Bot: ${status}`,
    run.testCase.name,
    `Run: ${run.id}`,
    run.error ? `Ошибка: ${run.error.slice(0, 500)}` : ""
  ].filter(Boolean).join("\n");
}
