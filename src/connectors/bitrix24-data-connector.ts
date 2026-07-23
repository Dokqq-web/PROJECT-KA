import {
  checkedHttpUrl,
  primitiveValues,
  type TestDataResult
} from "./test-data-types.js";

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
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        entityTypeId: options.entityTypeId ?? 3,
        select: ["*"],
        start: 0
      }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      throw new Error(`Битрикс24 ответил ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    const body = (await response.json()) as {
      result?: { items?: Array<Record<string, unknown>> };
      error_description?: string;
    };
    if (!Array.isArray(body.result?.items)) {
      throw new Error(body.error_description || "Битрикс24 вернул неожиданный ответ");
    }
    return {
      source: "bitrix24",
      records: body.result.items.map((item, index) => ({
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
