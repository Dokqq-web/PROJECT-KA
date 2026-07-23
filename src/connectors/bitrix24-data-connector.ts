import {
  checkedHttpUrl,
  primitiveValues,
  type TestDataResult
} from "./test-data-types.js";
import { reliableFetch } from "../http/reliable-fetch.js";
import { assertSafeExternalUrl } from "../security/url-policy.js";

export interface Bitrix24DataOptions {
  mode: "demo" | "live";
  webhookUrl?: string;
  entityTypeId?: number;
}

export class Bitrix24DataConnector {
  async fetch(options: Bitrix24DataOptions): Promise<TestDataResult> {
    if (options.mode === "demo") {
      return {
        source: "bitrix24",
        records: [{
          id: "B24-DEMO-1",
          label: "Иван Тестовый",
          values: {
            contactId: "101",
            contactName: "Иван Тестовый",
            email: "ivan.qa@example.test",
            phone: "+79990000001"
          }
        }]
      };
    }
    if (!options.webhookUrl) throw new Error("Для Битрикс24 нужен URL входящего вебхука");
    const root = checkedHttpUrl(options.webhookUrl, "Битрикс24");
    const endpoint = new URL(
      `${root.pathname.replace(/\/$/, "")}/crm.item.list.json`,
      root
    );
    await assertSafeExternalUrl(endpoint);
    const items: Array<Record<string, unknown>> = [];
    let start: number | undefined = 0;
    const limit = connectorLimit();
    while (start !== undefined && items.length < limit) {
      const response = await reliableFetch(endpoint, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          entityTypeId: options.entityTypeId ?? 3,
          select: ["*"],
          start
        })
      });
      if (!response.ok) {
        throw new Error(`Битрикс24 ответил ${response.status}: ${(await response.text()).slice(0, 500)}`);
      }
      const body = (await response.json()) as {
        result?: { items?: Array<Record<string, unknown>> };
        next?: number;
        error_description?: string;
      };
      if (!Array.isArray(body.result?.items)) {
        throw new Error(body.error_description || "Битрикс24 вернул неожиданный ответ");
      }
      items.push(...body.result.items);
      start = typeof body.next === "number" ? body.next : undefined;
    }
    return {
      source: "bitrix24",
      records: items.slice(0, limit).map((item, index) => ({
        id: String(item.id ?? index + 1),
        label: String(
          item.title ??
            ([item.name, item.lastName].filter(Boolean).join(" ") ||
              `Запись ${index + 1}`)
        ),
        values: primitiveValues(item)
      }))
    };
  }
}

function connectorLimit(): number {
  const value = Number(process.env.MAX_CONNECTOR_ITEMS ?? 500);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 5_000) : 500;
}
