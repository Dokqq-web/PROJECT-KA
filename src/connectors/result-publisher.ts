import type { RunRecord } from "../services/run-service.js";

export type PublishSystem = "jira" | "youtrack" | "kaiten";

export interface PublishOptions {
  mode: "demo" | "live";
  baseUrl?: string;
  token?: string;
  email?: string;
}

export class ResultPublisher {
  async publish(
    system: PublishSystem,
    run: RunRecord,
    options: PublishOptions
  ): Promise<{ published: true; system: PublishSystem; externalId: string; demo: boolean }> {
    const externalId = run.testCase.source?.externalId;
    if (!externalId || run.testCase.source?.system !== system) {
      throw new Error(`Запуск не связан с ${system}`);
    }
    if (options.mode === "demo") {
      return { published: true, system, externalId, demo: true };
    }
    const text = resultText(run);
    if (system === "jira") await publishJira(externalId, text, options);
    if (system === "youtrack") await publishYouTrack(externalId, text, options);
    if (system === "kaiten") await publishKaiten(externalId, text, options);
    return { published: true, system, externalId, demo: false };
  }
}

function resultText(run: RunRecord): string {
  const result = run.result;
  const status = run.cancelRequested
    ? "CANCELLED"
    : result?.status.toUpperCase() ?? "ERROR";
  const passed = result?.steps.filter((step) => step.status === "passed").length ?? 0;
  const total = result?.steps.length ?? run.testCase.steps.length;
  const failures =
    result?.steps
      .filter((step) => step.status === "failed")
      .map((step) => `${step.stepId}: ${step.error}`)
      .join("\n") || run.error;
  return [
    `QA Bot result: ${status}`,
    `Run: ${run.id}`,
    `Steps: ${passed}/${total}`,
    failures ? `Errors:\n${failures}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

async function publishJira(
  issueKey: string,
  text: string,
  options: PublishOptions
): Promise<void> {
  if (!options.baseUrl || !options.email || !options.token) {
    throw new Error("Для Jira нужны адрес, email и API token");
  }
  const endpoint = new URL(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
    checkedUrl(options.baseUrl)
  );
  const credentials = Buffer.from(`${options.email}:${options.token}`).toString("base64");
  await send(endpoint, {
    authorization: `Basic ${credentials}`,
    body: {
      body: {
        type: "doc",
        version: 1,
        content: [{
          type: "paragraph",
          content: [{ type: "text", text }]
        }]
      }
    }
  });
}

async function publishYouTrack(
  issueId: string,
  text: string,
  options: PublishOptions
): Promise<void> {
  if (!options.baseUrl || !options.token) {
    throw new Error("Для YouTrack нужны адрес и permanent token");
  }
  const endpoint = new URL(
    `/api/issues/${encodeURIComponent(issueId)}/comments`,
    checkedUrl(options.baseUrl)
  );
  await send(endpoint, {
    authorization: `Bearer ${options.token}`,
    body: { text }
  });
}

async function publishKaiten(
  externalId: string,
  text: string,
  options: PublishOptions
): Promise<void> {
  if (!options.baseUrl || !options.token) {
    throw new Error("Для Kaiten нужны адрес и bearer token");
  }
  const cardId = externalId.replace(/^KAITEN-/, "");
  const endpoint = new URL(
    `/api/latest/cards/${encodeURIComponent(cardId)}/comments`,
    checkedUrl(options.baseUrl)
  );
  await send(endpoint, {
    authorization: `Bearer ${options.token}`,
    body: { text }
  });
}

async function send(
  endpoint: URL,
  input: { authorization: string; body: unknown }
): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: input.authorization
    },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`Система ответила ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
}

function checkedUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Адрес должен использовать HTTP или HTTPS");
  }
  return url;
}

