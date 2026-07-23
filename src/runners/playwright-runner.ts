import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  chromium,
  type FrameLocator,
  type Locator,
  type Page
} from "playwright";
import type {
  StepResult,
  TestCase,
  TestResult,
  TestStep
} from "../domain/test-case.js";
import type { TestRunner } from "../ports/test-runner.js";

export interface PlaywrightRunnerOptions {
  artifactsDirectory?: string;
  headless?: boolean;
}

export class PlaywrightRunner implements TestRunner {
  constructor(private readonly options: PlaywrightRunnerOptions = {}) {}

  async run(testCase: TestCase, signal?: AbortSignal): Promise<TestResult> {
    if (testCase.platform !== "web") {
      throw new Error(`PlaywrightRunner cannot run platform: ${testCase.platform}`);
    }

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const artifactsDirectory = resolve(
      this.options.artifactsDirectory ?? "artifacts",
      runId
    );
    await mkdir(artifactsDirectory, { recursive: true });

    const browser = await chromium.launch({
      headless: this.options.headless ?? true
    });
    const abort = () => void browser.close().catch(() => undefined);
    signal?.addEventListener("abort", abort, { once: true });
    const page = await browser.newPage();
    const state: BrowserState = { page };
    const variables = { ...(testCase.variables ?? {}) };
    const steps: StepResult[] = [];
    let failed = false;

    try {
      for (const step of testCase.steps) {
        if (signal?.aborted) throw new Error("Запуск отменён пользователем");
        if (failed) {
          const timestamp = new Date().toISOString();
          steps.push({
            stepId: step.id,
            status: "skipped",
            startedAt: timestamp,
            finishedAt: timestamp
          });
          continue;
        }

        const stepStartedAt = new Date().toISOString();
        try {
          const artifacts = await executeStep(
            state,
            testCase,
            step,
            variables,
            artifactsDirectory
          );
          steps.push({
            stepId: step.id,
            status: "passed",
            startedAt: stepStartedAt,
            finishedAt: new Date().toISOString(),
            artifacts: artifacts.length > 0 ? artifacts : undefined
          });
        } catch (error) {
          if (signal?.aborted) {
            throw new Error("Запуск отменён пользователем");
          }
          failed = true;
          const screenshotPath = resolve(
            artifactsDirectory,
            `step-${safeName(step.id)}-failure.png`
          );
          await state.page.screenshot({ path: screenshotPath, fullPage: true });
          steps.push({
            stepId: step.id,
            status: "failed",
            startedAt: stepStartedAt,
            finishedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
            artifacts: [screenshotPath]
          });
        }
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      await browser.close().catch(() => undefined);
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

async function executeStep(
  state: BrowserState,
  testCase: TestCase,
  step: TestStep,
  variables: Record<string, string>,
  artifactsDirectory: string
): Promise<string[]> {
  const page = state.page;
  const target = interpolate(step.target, variables);
  const value = interpolate(step.value, variables);
  const timeout = step.timeoutMs ?? 10_000;

  switch (step.action) {
    case "open": {
      if (!target) throw new Error("open requires target");
      const url = new URL(target, testCase.baseUrl).toString();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      return [];
    }
    case "click":
      await requiredLocator(state, target).click({ timeout });
      return [];
    case "fill":
      await requiredLocator(state, target).fill(value ?? "", { timeout });
      return [];
    case "select":
      await requiredLocator(state, target).selectOption(value ?? "", { timeout });
      return [];
    case "assertText": {
      if (value === undefined) throw new Error("assertText requires value");
      const locator = requiredLocator(state, target);
      await locator.waitFor({ state: "visible", timeout });
      const actual = (await locator.textContent()) ?? "";
      if (!actual.includes(value)) {
        throw new Error(`Expected text "${value}", received "${actual.trim()}"`);
      }
      return [];
    }
    case "assertVisible":
      await requiredLocator(state, target).waitFor({
        state: "visible",
        timeout
      });
      return [];
    case "wait": {
      const milliseconds = Number(value ?? target);
      if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        throw new Error("wait requires a non-negative duration");
      }
      await page.waitForTimeout(milliseconds);
      return [];
    }
    case "apiRequest": {
      if (!target) throw new Error("apiRequest requires target URL");
      const url = new URL(target, testCase.baseUrl).toString();
      const headers = Object.fromEntries(
        Object.entries(step.headers ?? {}).map(([key, headerValue]) => [
          key,
          interpolate(headerValue, variables) ?? ""
        ])
      );
      const response = await fetch(url, {
        method: step.method ?? "GET",
        headers,
        body:
          step.method && !["GET", "DELETE"].includes(step.method)
            ? value
            : undefined,
        signal: AbortSignal.timeout(timeout)
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(
          `API ${response.status}: ${responseText.slice(0, 500)}`
        );
      }
      if (step.saveAs) variables[step.saveAs] = responseText;
      return [];
    }
    case "assertJson": {
      if (!step.target) throw new Error("assertJson requires target");
      const [variableName, ...path] = step.target.split(".");
      const raw = variables[variableName!];
      if (raw === undefined) throw new Error(`Missing variable: ${variableName}`);
      let actual: unknown = JSON.parse(raw);
      for (const segment of path) {
        if (actual === null || typeof actual !== "object") {
          throw new Error(`JSON path not found: ${step.target}`);
        }
        actual = (actual as Record<string, unknown>)[segment];
      }
      if (String(actual) !== String(value ?? "")) {
        throw new Error(
          `Expected JSON ${step.target}="${value ?? ""}", received "${String(actual)}"`
        );
      }
      return [];
    }
    case "if": {
      if (!step.target) throw new Error("if requires variable name in target");
      if (variables[step.target] === (value ?? "")) {
        for (const nested of step.steps ?? []) {
          await executeStep(state, testCase, nested, variables, artifactsDirectory);
        }
      }
      return [];
    }
    case "repeat": {
      const count = Number(value ?? step.target);
      if (!Number.isInteger(count) || count < 0 || count > 100) {
        throw new Error("repeat count must be an integer from 0 to 100");
      }
      for (let index = 0; index < count; index += 1) {
        variables.repeatIndex = String(index);
        for (const nested of step.steps ?? []) {
          await executeStep(state, testCase, nested, variables, artifactsDirectory);
        }
      }
      return [];
    }
    case "setFrame":
      if (!target) throw new Error("setFrame requires iframe selector");
      state.frame = state.page.frameLocator(target);
      return [];
    case "resetFrame":
      state.frame = undefined;
      return [];
    case "clickNewTab": {
      const newPagePromise = state.page.context().waitForEvent("page", { timeout });
      await requiredLocator(state, target).click({ timeout });
      state.page = await newPagePromise;
      state.frame = undefined;
      await state.page.waitForLoadState("domcontentloaded", { timeout });
      return [];
    }
    case "switchTab": {
      const pages = state.page.context().pages();
      const index = value === "last" || target === "last"
        ? pages.length - 1
        : Number(value ?? target);
      if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
        throw new Error(`switchTab index is out of range: ${String(value ?? target)}`);
      }
      state.page = pages[index]!;
      state.frame = undefined;
      await state.page.bringToFront();
      return [];
    }
    case "uploadFile":
      if (!value) throw new Error("uploadFile requires file path in value");
      await requiredLocator(state, target).setInputFiles(resolve(value), { timeout });
      return [];
    case "download": {
      const downloadPromise = state.page.waitForEvent("download", { timeout });
      await requiredLocator(state, target).click({ timeout });
      const download = await downloadPromise;
      const name = safeArtifactName(value || download.suggestedFilename());
      const path = resolve(artifactsDirectory, name);
      await download.saveAs(path);
      return [path];
    }
    case "mockRoute": {
      if (!target) throw new Error("mockRoute requires URL glob in target");
      let body: unknown = value ?? "";
      try {
        body = value === undefined ? "" : JSON.parse(value);
      } catch {
        body = value;
      }
      await state.page.route(target, async (route) => {
        await route.fulfill({
          status: step.statusCode ?? 200,
          contentType: typeof body === "string" ? "text/plain" : "application/json",
          body: typeof body === "string" ? body : JSON.stringify(body),
          headers: step.headers
        });
      });
      return [];
    }
    case "clearMocks":
      await state.page.unroute(target || "**/*");
      return [];
    case "screenshot": {
      const path = resolve(
        artifactsDirectory,
        safeArtifactName(value || `step-${step.id}.png`)
      );
      await state.page.screenshot({ path, fullPage: true });
      return [path];
    }
  }
}

interface BrowserState {
  page: Page;
  frame?: FrameLocator;
}

function requiredLocator(
  state: BrowserState,
  target: string | undefined
): Locator {
  if (!target) throw new Error("Step requires target");
  return (state.frame
    ? state.frame.locator(target)
    : state.page.locator(target)).first();
}

function interpolate(
  input: string | undefined,
  variables: Record<string, string> = {}
): string | undefined {
  return input?.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    if (key.startsWith("SECRET:")) {
      const environmentKey = key.slice("SECRET:".length);
      const secret = process.env[environmentKey];
      if (secret === undefined) throw new Error(`Missing secret: ${environmentKey}`);
      return secret;
    }
    const value = variables[key];
    if (value === undefined) throw new Error(`Missing variable: ${key}`);
    return value;
  });
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function safeArtifactName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
