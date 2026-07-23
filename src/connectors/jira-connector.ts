import type { TestCase } from "../domain/test-case.js";
import { parseQaBlock } from "./qa-block-parser.js";

export interface JiraImportOptions {
  mode: "demo" | "live";
  baseUrl?: string;
  email?: string;
  token?: string;
  query?: string;
}

interface JiraIssue {
  id: string;
  key: string;
  fields?: { summary?: string; description?: unknown };
}

export class JiraConnector {
  async import(options: JiraImportOptions): Promise<{
    testCases: TestCase[];
    errors: string[];
    issuesRead: number;
  }> {
    const issues = options.mode === "demo" ? demoIssues() : await fetchIssues(options);
    const testCases: TestCase[] = [];
    const errors: string[] = [];
    for (const issue of issues) {
      const parsed = parseQaBlock({
        externalId: issue.key || issue.id,
        name: issue.fields?.summary?.trim() || `Тест ${issue.key}`,
        description: adfToText(issue.fields?.description),
        source: "jira"
      });
      if (parsed.testCase) testCases.push(parsed.testCase);
      if (parsed.error) errors.push(parsed.error);
    }
    return { testCases, errors, issuesRead: issues.length };
  }
}

async function fetchIssues(options: JiraImportOptions): Promise<JiraIssue[]> {
  if (!options.baseUrl || !options.email || !options.token) {
    throw new Error("Для Jira нужны адрес, email и API token");
  }
  const baseUrl = checkedUrl(options.baseUrl, "Jira");
  const endpoint = new URL("/rest/api/3/search/jql", baseUrl);
  const credentials = Buffer.from(`${options.email}:${options.token}`).toString("base64");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Basic ${credentials}`
    },
    body: JSON.stringify({
      jql: options.query?.trim() || "ORDER BY updated DESC",
      fields: ["summary", "description"],
      maxResults: 50
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`Jira ответила ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const value = (await response.json()) as { issues?: JiraIssue[] };
  if (!Array.isArray(value.issues)) throw new Error("Jira вернула неожиданный ответ");
  return value.issues;
}

function adfToText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const node = value as { text?: unknown; type?: unknown; content?: unknown };
  const ownText = typeof node.text === "string" ? node.text : "";
  const children = Array.isArray(node.content)
    ? node.content.map(adfToText).filter(Boolean).join("")
    : "";
  const suffix = ["paragraph", "heading", "codeBlock"].includes(String(node.type))
    ? "\n"
    : "";
  return `${ownText}${children}${suffix}`;
}

function checkedUrl(value: string, system: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Адрес ${system} должен использовать HTTP или HTTPS`);
  }
  return url;
}

function demoIssues(): JiraIssue[] {
  return [{
    id: "10001",
    key: "DEMO-JIRA-1",
    fields: {
      summary: "Jira: успешный вход",
      description: "```qa\nbaseUrl=http://localhost:4173\nopen | /\nfill | [name=email] | qa@example.test\nfill | [name=password] | testing123\nclick | button[type=submit]\nassertVisible | [data-testid=dashboard]\n```"
    }
  }];
}

