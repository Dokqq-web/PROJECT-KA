import type { TestCase, TestStep, TestStepAction } from "../domain/test-case.js";
import type { SavedTestCase } from "../repositories/test-case-repository.js";
import { TestCaseService } from "./test-case-service.js";

export type ImportFormat = "json" | "csv";

export interface ImportResult {
  imported: SavedTestCase[];
  errors: string[];
}

const supportedActions = new Set<TestStepAction>([
  "open",
  "click",
  "fill",
  "select",
  "assertText",
  "assertVisible",
  "wait",
  "apiRequest",
  "assertJson",
  "if",
  "repeat"
]);

export class TestCaseImportService {
  constructor(private readonly testCases: TestCaseService) {}

  import(format: ImportFormat, content: string): ImportResult {
    const parsed = format === "json" ? parseJson(content) : parseCsv(content);
    const imported: SavedTestCase[] = [];
    const errors = [...parsed.errors];

    parsed.testCases.forEach((testCase, index) => {
      const validationErrors = validateImportedTestCase(testCase);
      if (validationErrors.length > 0) {
        errors.push(
          ...validationErrors.map(
            (error) => `${testCase.name || `Тест ${index + 1}`}: ${error}`
          )
        );
        return;
      }
      imported.push(this.testCases.create(testCase));
    });

    return { imported, errors };
  }
}

function parseJson(content: string): {
  testCases: TestCase[];
  errors: string[];
} {
  try {
    const value: unknown = JSON.parse(content);
    if (Array.isArray(value)) {
      return { testCases: value as TestCase[], errors: [] };
    }
    if (isRecord(value) && Array.isArray(value.testCases)) {
      return { testCases: value.testCases as TestCase[], errors: [] };
    }
    if (isRecord(value)) {
      return { testCases: [value as unknown as TestCase], errors: [] };
    }
    return { testCases: [], errors: ["JSON должен содержать объект или массив"] };
  } catch (error) {
    return {
      testCases: [],
      errors: [
        `Некорректный JSON: ${error instanceof Error ? error.message : String(error)}`
      ]
    };
  }
}

function parseCsv(content: string): {
  testCases: TestCase[];
  errors: string[];
} {
  const rows = parseCsvRows(content);
  if (rows.length < 2) {
    return { testCases: [], errors: ["CSV не содержит строк с тестами"] };
  }

  const headers = rows[0]!.map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim()
  );
  const required = [
    "testCaseId",
    "testCaseName",
    "baseUrl",
    "stepId",
    "action",
    "target",
    "value"
  ];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    return {
      testCases: [],
      errors: [`В CSV отсутствуют колонки: ${missing.join(", ")}`]
    };
  }

  const groups = new Map<string, TestCase>();
  const errors: string[] = [];

  rows.slice(1).forEach((values, rowIndex) => {
    if (values.every((value) => value.trim() === "")) return;
    const row = Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""])
    );
    const key = row.testCaseId!.trim();
    if (!key) {
      errors.push(`Строка ${rowIndex + 2}: testCaseId обязателен`);
      return;
    }

    let testCase = groups.get(key);
    if (!testCase) {
      testCase = {
        id: key,
        name: row.testCaseName!.trim(),
        platform: "web",
        baseUrl: row.baseUrl!.trim(),
        steps: [],
        source: { system: "manual" }
      };
      groups.set(key, testCase);
    }

    const action = row.action!.trim() as TestStepAction;
    if (!supportedActions.has(action)) {
      errors.push(`Строка ${rowIndex + 2}: неизвестное действие "${action}"`);
      return;
    }

    const step: TestStep = {
      id: row.stepId!.trim() || String(testCase.steps.length + 1),
      action
    };
    if (row.target) step.target = row.target;
    if (row.value) step.value = row.value;
    if (row.timeoutMs) {
      const timeoutMs = Number(row.timeoutMs);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
        errors.push(`Строка ${rowIndex + 2}: timeoutMs должен быть числом`);
      } else {
        step.timeoutMs = timeoutMs;
      }
    }
    testCase.steps.push(step);
  });

  return { testCases: [...groups.values()], errors };
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function validateImportedTestCase(testCase: TestCase): string[] {
  const errors: string[] = [];
  if (!testCase || typeof testCase !== "object") return ["должен быть объектом"];
  if (!nonEmptyString(testCase.name)) errors.push("название обязательно");
  if (!["web", "android", "ios"].includes(testCase.platform)) {
    errors.push("platform должен быть web, android или ios");
  }
  if (!Array.isArray(testCase.steps) || testCase.steps.length === 0) {
    errors.push("нужен хотя бы один шаг");
    return errors;
  }
  testCase.steps.forEach((step, index) => {
    if (!step || !supportedActions.has(step.action)) {
      errors.push(`шаг ${index + 1} содержит неизвестное действие`);
    }
  });
  return errors;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
