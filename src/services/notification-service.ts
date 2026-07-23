import type { RunRecord } from "./run-service.js";

export interface NotificationStatus {
  webhookConfigured: boolean;
  telegramConfigured: boolean;
  managedSecretConfigured: boolean;
  notifyOn: "always" | "failure";
}

type FetchLike = typeof fetch;
export interface ManagedNotificationConfig {
  webhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  notifyOn?: "always" | "failure";
}

export class NotificationService {
  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly fetcher: FetchLike = fetch,
    private readonly managedConfig: () => ManagedNotificationConfig | undefined =
      () => undefined
  ) {}

  status(): NotificationStatus {
    const managed = this.managedConfig();
    const configuration = this.configuration();
    return {
      webhookConfigured: Boolean(configuration.webhookUrl),
      telegramConfigured: Boolean(
        configuration.telegramBotToken &&
        configuration.telegramChatId
      ),
      managedSecretConfigured: Boolean(managed),
      notifyOn: configuration.notifyOn ?? "always"
    };
  }

  async notifyRunCompleted(run: RunRecord): Promise<void> {
    if (this.configuration().notifyOn === "failure" && runPassed(run)) return;
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
    const configuration = this.configuration();
    const webhookUrl = configuration.webhookUrl;
    if (webhookUrl) {
      tasks.push(this.postJson(webhookUrl, payload));
    }
    const token = configuration.telegramBotToken;
    const chatId = configuration.telegramChatId;
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

  private configuration(): ManagedNotificationConfig {
    const managed = this.managedConfig() ?? {};
    return {
      webhookUrl: managed.webhookUrl ?? this.environment.NOTIFICATION_WEBHOOK_URL,
      telegramBotToken:
        managed.telegramBotToken ?? this.environment.TELEGRAM_BOT_TOKEN,
      telegramChatId:
        managed.telegramChatId ?? this.environment.TELEGRAM_CHAT_ID,
      notifyOn:
        managed.notifyOn ??
        (this.environment.NOTIFICATION_NOTIFY_ON === "failure"
          ? "failure"
          : "always")
    };
  }
}

function runPassed(run: RunRecord): boolean {
  return !run.error && run.result?.status === "passed";
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
