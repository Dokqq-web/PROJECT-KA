import type { TestCase } from "../domain/test-case.js";
import { parseQaBlock } from "./qa-block-parser.js";

export interface KaitenImportOptions {
  mode: "demo" | "live";
  baseUrl?: string;
  token?: string;
  query?: string;
}

interface KaitenCard {
  id: number;
  title?: string;
  description?: string | null;
}

export class KaitenConnector {
  async import(options: KaitenImportOptions): Promise<{
    testCases: TestCase[];
    errors: string[];
    issuesRead: number;
  }> {
    const cards = options.mode === "demo" ? demoCards() : await fetchCards(options);
    const testCases: TestCase[] = [];
    const errors: string[] = [];
    for (const card of cards) {
      const externalId = `KAITEN-${card.id}`;
      const parsed = parseQaBlock({
        externalId,
        name: card.title?.trim() || `Карточка ${card.id}`,
        description: card.description ?? undefined,
        source: "kaiten"
      });
      if (parsed.testCase) testCases.push(parsed.testCase);
      if (parsed.error) errors.push(parsed.error);
    }
    return { testCases, errors, issuesRead: cards.length };
  }
}

async function fetchCards(options: KaitenImportOptions): Promise<KaitenCard[]> {
  if (!options.baseUrl || !options.token) {
    throw new Error("Для Kaiten нужны адрес сервера и bearer token");
  }
  const baseUrl = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("Адрес Kaiten должен использовать HTTP или HTTPS");
  }
  const endpoint = new URL("/api/latest/cards", baseUrl);
  endpoint.searchParams.set("additional_card_fields", "description");
  endpoint.searchParams.set("limit", "50");
  if (options.query?.trim()) endpoint.searchParams.set("query", options.query.trim());
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${options.token}`
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`Kaiten ответил ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new Error("Kaiten вернул неожиданный ответ");
  return value as KaitenCard[];
}

function demoCards(): KaitenCard[] {
  return [{
    id: 1,
    title: "Kaiten: успешный вход",
    description: "```qa\nbaseUrl=http://localhost:4173\nopen | /\nfill | [name=email] | qa@example.test\nfill | [name=password] | testing123\nclick | button[type=submit]\nassertVisible | [data-testid=dashboard]\n```"
  }];
}

