import {
  checkedHttpUrl,
  primitiveValues,
  type TestDataResult
} from "./test-data-types.js";
import { reliableFetch } from "../http/reliable-fetch.js";
import { assertSafeExternalUrl } from "../security/url-policy.js";

export interface AmoCrmDataOptions {
  mode: "demo" | "live";
  baseUrl?: string;
  accessToken?: string;
  query?: string;
}

interface AmoContact extends Record<string, unknown> {
  id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  custom_fields_values?: Array<{
    field_code?: string;
    field_name?: string;
    values?: Array<{ value?: unknown }>;
  }> | null;
}

export class AmoCrmDataConnector {
  async fetch(options: AmoCrmDataOptions): Promise<TestDataResult> {
    if (options.mode === "demo") {
      return {
        source: "amocrm",
        records: [{
          id: "AMO-DEMO-1",
          label: "Анна Тестовая",
          values: {
            contactId: "202",
            contactName: "Анна Тестовая",
            email: "anna.qa@example.test",
            phone: "+79990000002"
          }
        }]
      };
    }
    if (!options.baseUrl || !options.accessToken) {
      throw new Error("Для amoCRM нужны адрес аккаунта и OAuth access token");
    }
    const root = checkedHttpUrl(options.baseUrl, "amoCRM");
    const endpoint = new URL("/api/v4/contacts", root);
    endpoint.searchParams.set("limit", "20");
    if (options.query?.trim()) endpoint.searchParams.set("query", options.query.trim());
    await assertSafeExternalUrl(endpoint);
    const contacts: AmoContact[] = [];
    let next: URL | undefined = endpoint;
    const limit = connectorLimit();
    while (next && contacts.length < limit) {
      await assertSafeExternalUrl(next);
      const response = await reliableFetch(next, {
        headers: {
          accept: "application/hal+json",
          authorization: `Bearer ${options.accessToken}`
        }
      });
      if (!response.ok) {
        throw new Error(`amoCRM ответила ${response.status}: ${(await response.text()).slice(0, 500)}`);
      }
      const body = (await response.json()) as {
        _embedded?: { contacts?: AmoContact[] };
        _links?: { next?: { href?: string } };
      };
      const page = body._embedded?.contacts;
      if (!Array.isArray(page)) throw new Error("amoCRM вернула неожиданный ответ");
      contacts.push(...page);
      next = body._links?.next?.href
        ? new URL(body._links.next.href, next)
        : undefined;
    }
    return {
      source: "amocrm",
      records: contacts.slice(0, limit).map((contact) => ({
        id: String(contact.id),
        label: contact.name || [contact.first_name, contact.last_name].filter(Boolean).join(" ") || `Контакт ${contact.id}`,
        values: {
          ...primitiveValues(contact),
          ...customFieldValues(contact)
        }
      }))
    };
  }
}

function connectorLimit(): number {
  const value = Number(process.env.MAX_CONNECTOR_ITEMS ?? 500);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 5_000) : 500;
}

function customFieldValues(contact: AmoContact): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of contact.custom_fields_values ?? []) {
    const key = field.field_code || field.field_name;
    const value = field.values?.[0]?.value;
    if (key && value !== undefined && value !== null) {
      result[key.toLowerCase()] = String(value);
    }
  }
  return result;
}
