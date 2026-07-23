import type { TestCase } from "../domain/test-case.js";
import { reliableFetch } from "../http/reliable-fetch.js";
import { assertSafeExternalUrl } from "../security/url-policy.js";
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
  await assertSafeExternalUrl(endpoint);
  endpoint.searchParams.set("fields", "id,idReadable,summary,description");
  const pageSize = Math.min(options.limit ?? 100, 100);
  endpoint.searchParams.set("$top", String(pageSize));
  if (options.query?.trim()) endpoint.searchParams.set("query", options.query.trim());

  const issues: YouTrackIssue[] = [];
  const limit = connectorLimit();
  while (issues.length < limit) {
    endpoint.searchParams.set("$skip", String(issues.length));
    const response = await reliableFetch(endpoint, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.token}`
      }
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(`YouTrack ответил ${response.status}: ${details}`);
    }
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw new Error("YouTrack вернул неожиданный ответ");
    issues.push(...(value as YouTrackIssue[]));
    if (value.length < pageSize) break;
  }
  return issues.slice(0, limit);
}

function connectorLimit(): number {
  const value = Number(process.env.MAX_CONNECTOR_ITEMS ?? 500);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 5_000) : 500;
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
