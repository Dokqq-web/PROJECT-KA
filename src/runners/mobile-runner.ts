import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  StepResult,
  TestCase,
  TestResult,
  TestStep
} from "../domain/test-case.js";
import type { TestRunner } from "../ports/test-runner.js";
import { DeviceService } from "../services/device-service.js";

export class MobileRunner implements TestRunner {
  constructor(
    private readonly devices: DeviceService,
    private readonly artifactsDirectory = "artifacts"
  ) {}

  async run(testCase: TestCase, signal?: AbortSignal): Promise<TestResult> {
    const deviceId = testCase.variables?.deviceId;
    if (!deviceId) throw new Error("Для мобильного теста нужна variables.deviceId");
    const device = this.devices.get(deviceId);
    if (!device || !device.enabled) throw new Error("Мобильное устройство недоступно");
    if (device.platform !== testCase.platform) {
      throw new Error("Платформа устройства не совпадает с тест-кейсом");
    }

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const artifactDirectory = resolve(this.artifactsDirectory, runId);
    await mkdir(artifactDirectory, { recursive: true });
    const session = await request(device.appiumEndpoint, "/session", {
      method: "POST",
      body: {
        capabilities: {
          alwaysMatch: {
            platformName: testCase.platform === "ios" ? "iOS" : "Android",
            ...device.capabilities
          }
        }
      },
      signal
    });
    const sessionId = String(session.sessionId ?? session.value?.sessionId ?? "");
    if (!sessionId) throw new Error("Appium не вернул sessionId");
    const base = `${device.appiumEndpoint}/session/${sessionId}`;
    const variables = { ...(testCase.variables ?? {}) };
    const steps: StepResult[] = [];
    let failed = false;

    try {
      for (const step of testCase.steps) {
        const stepStarted = new Date().toISOString();
        if (failed) {
          steps.push({
            stepId: step.id,
            status: "skipped",
            startedAt: stepStarted,
            finishedAt: stepStarted
          });
          continue;
        }
        try {
          await executeMobileStep(base, step, variables, signal);
          steps.push({
            stepId: step.id,
            status: "passed",
            startedAt: stepStarted,
            finishedAt: new Date().toISOString()
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          failed = true;
          const screenshotPath = resolve(artifactDirectory, `step-${step.id}.png`);
          try {
            const screenshot = await request(base, "/screenshot", { signal });
            await writeFile(screenshotPath, Buffer.from(String(screenshot.value), "base64"));
          } catch {}
          steps.push({
            stepId: step.id,
            status: "failed",
            startedAt: stepStarted,
            finishedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
            artifacts: [screenshotPath]
          });
        }
      }
    } finally {
      await request(base, "", { method: "DELETE" }).catch(() => undefined);
    }

    return {
      runId,
      testCaseId: testCase.id,
      status: failed ? "failed" : "passed",
      startedAt,
      finishedAt: new Date().toISOString(),
      steps
    };
  }
}

async function executeMobileStep(
  base: string,
  step: TestStep,
  variables: Record<string, string>,
  signal?: AbortSignal
): Promise<void> {
  const target = interpolate(step.target, variables);
  const value = interpolate(step.value, variables);
  switch (step.action) {
    case "open":
      await request(base, "/url", {
        method: "POST",
        body: { url: target },
        signal
      });
      return;
    case "wait":
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, Number(value ?? target ?? 0))
      );
      return;
    case "click":
    case "fill":
    case "assertVisible":
    case "assertText": {
      const elementId = await findElement(base, target, signal);
      if (step.action === "click") {
        await request(base, `/element/${elementId}/click`, { method: "POST", body: {}, signal });
      } else if (step.action === "fill") {
        await request(base, `/element/${elementId}/value`, {
          method: "POST",
          body: { text: value ?? "", value: [...(value ?? "")] },
          signal
        });
      } else if (step.action === "assertText") {
        const response = await request(base, `/element/${elementId}/text`, { signal });
        if (!String(response.value ?? "").includes(value ?? "")) {
          throw new Error(`Ожидался текст "${value}"`);
        }
      }
      return;
    }
    default:
      throw new Error(`Действие ${step.action} пока не поддерживается MobileRunner`);
  }
}

async function findElement(
  base: string,
  target: string | undefined,
  signal?: AbortSignal
): Promise<string> {
  if (!target) throw new Error("Для шага нужен селектор");
  const [prefix, ...rest] = target.split("=");
  const strategies: Record<string, string> = {
    accessibility: "accessibility id",
    id: "id",
    xpath: "xpath"
  };
  const using = strategies[prefix!] ?? "accessibility id";
  const value = strategies[prefix!] ? rest.join("=") : target;
  const response = await request(base, "/element", {
    method: "POST",
    body: { using, value },
    signal
  });
  const element = response.value ?? {};
  const id =
    element["element-6066-11e4-a52e-4f735466cecf"] ?? element.ELEMENT;
  if (!id) throw new Error(`Элемент не найден: ${target}`);
  return String(id);
}

async function request(
  base: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
  } = {}
): Promise<any> {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || payload.value?.error) {
    throw new Error(payload.value?.message || `WebDriver ответил ${response.status}`);
  }
  return payload;
}

function interpolate(
  input: string | undefined,
  variables: Record<string, string>
): string | undefined {
  return input?.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    const value = variables[key];
    if (value === undefined) throw new Error(`Missing variable: ${key}`);
    return value;
  });
}

