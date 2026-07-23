import type { TestCase } from "../domain/test-case.js";
import { parseQaBlock } from "./qa-block-parser.js";

export interface YouTrackImportOptions {
  mode: "demo" | "live";
  baseUrl?: string;
  token?: string;
  query?: string;
  limit?: number;
}

export interface YouTrackImportResult {
  testCases: TestCase[];
  errors: string[];
  issuesRead: number;
}

interface YouTrackIssue {
  id: string;
  idReadable?: string;
  summary?: string;
  description?: string;
}

export class YouTrackConnector {
  async import(options: YouTrackImportOptions): Promise<YouTrackImportResult> {
    const issues =
      options.mode === "demo"
        ? demoIssues()
        : await fetchIssues(options);

    const testCases: TestCase[] = [];
    const errors: string[] = [];
    for (const issue of issues) {
      const readableId = issue.idReadable || issue.id;
      const parsed = parseQaBlock({
        externalId: readableId,
        name: issue.summary?.trim() || `Тест ${readableId}`,
        description: issue.description,
        source: "youtrack"
      });
      if (parsed.testCase) testCases.push(parsed.testCase);
      if (parsed.error) errors.push(parsed.error);
    }
    return { testCases, errors, issuesRead: issues.length };
  }
}

async function fetchIssues(options: YouTrackImportOptions): Promise<YouTrackIssue[]> {
  if (!options.baseUrl || !options.token) {
    throw new Error("Для YouTrack нужны адрес сервера и permanent token");
  }

  const baseUrl = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("Адрес YouTrack должен использовать HTTP или HTTPS");
  }

  const endpoint = new URL("/api/issues", baseUrl);
  endpoint.searchParams.set("fields", "id,idReadable,summary,description");
  endpoint.searchParams.set("$top", String(Math.min(options.limit ?? 50, 100)));
  if (options.query?.trim()) endpoint.searchParams.set("query", options.query.trim());

  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${options.token}`
    },
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`YouTrack ответил ${response.status}: ${details}`);
  }
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new Error("YouTrack вернул неожиданный ответ");
  return value as YouTrackIssue[];
}

function demoIssues(): YouTrackIssue[] {
  return [
    {
      id: "demo-1",
      idReadable: "DEMO-1",
      summary: "YouTrack: успешный вход",
      description: [
        "Проверка входа тестового пользователя.",
        "",
        "```qa",
        "baseUrl=http://localhost:4173",
        "open | /",
        "fill | [name=email] | qa@example.test",
        "fill | [name=password] | testing123",
        "click | button[type=submit]",
        "assertVisible | [data-testid=dashboard] | | 10000",
        "```"
      ].join("\n")
    }
  ];
}
