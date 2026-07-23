import type { TestCase } from "../domain/test-case.js";
import { reliableFetch } from "../http/reliable-fetch.js";
import { assertSafeExternalUrl } from "../security/url-policy.js";
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
  await assertSafeExternalUrl(endpoint);
  endpoint.searchParams.set("additional_card_fields", "description");
  const pageSize = 100;
  endpoint.searchParams.set("limit", String(pageSize));
  if (options.query?.trim()) endpoint.searchParams.set("query", options.query.trim());
  const cards: KaitenCard[] = [];
  const limit = connectorLimit();
  while (cards.length < limit) {
    endpoint.searchParams.set("offset", String(cards.length));
    const response = await reliableFetch(endpoint, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.token}`
      }
    });
    if (!response.ok) {
      throw new Error(`Kaiten ответил ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw new Error("Kaiten вернул неожиданный ответ");
    cards.push(...(value as KaitenCard[]));
    if (value.length < pageSize) break;
  }
  return cards.slice(0, limit);
}

function connectorLimit(): number {
  const value = Number(process.env.MAX_CONNECTOR_ITEMS ?? 500);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 5_000) : 500;
}

function demoCards(): KaitenCard[] {
  return [{
    id: 1,
    title: "Kaiten: успешный вход",
    description: "```qa\nbaseUrl=http://localhost:4173\nopen | /\nfill | [name=email] | qa@example.test\nfill | [name=password] | testing123\nclick | button[type=submit]\nassertVisible | [data-testid=dashboard]\n```"
  }];
}
