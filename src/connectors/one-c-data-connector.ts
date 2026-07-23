import {
  checkedHttpUrl,
  primitiveValues,
  type TestDataResult
} from "./test-data-types.js";

export interface OneCDataOptions {
  mode: "demo" | "live";
  baseUrl?: string;
  username?: string;
  password?: string;
  entity?: string;
  filter?: string;
}

export class OneCDataConnector {
  async fetch(options: OneCDataOptions): Promise<TestDataResult> {
    if (options.mode === "demo") {
      return {
        source: "1c",
        records: [{
          id: "1C-DEMO-1",
          label: "Тестовая номенклатура",
          values: {
            productId: "000000001",
            productName: "Тестовый товар",
            price: "1500",
            warehouse: "Основной"
          }
        }]
      };
    }
    if (!options.baseUrl || !options.username || !options.password || !options.entity) {
      throw new Error("Для 1С нужны OData URL, пользователь, пароль и сущность");
    }
    if (!/^[\p{L}\p{N}_]+$/u.test(options.entity)) {
      throw new Error("Имя сущности 1С содержит недопустимые символы");
    }
    const root = checkedHttpUrl(options.baseUrl, "1С");
    const endpoint = new URL(
      `${root.pathname.replace(/\/$/, "")}/${encodeURIComponent(options.entity)}`,
      root
    );
    endpoint.searchParams.set("$format", "json");
    endpoint.searchParams.set("$top", "20");
    if (options.filter?.trim()) endpoint.searchParams.set("$filter", options.filter.trim());
    const credentials = Buffer.from(`${options.username}:${options.password}`).toString("base64");
    const response = await fetch(endpoint, {
      headers: { accept: "application/json", authorization: `Basic ${credentials}` },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      throw new Error(`1С ответила ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    const body = (await response.json()) as { value?: Array<Record<string, unknown>> };
    if (!Array.isArray(body.value)) throw new Error("1С вернула неожиданный OData-ответ");
    return {
      source: "1c",
      records: body.value.map((item, index) => ({
        id: String(item.Ref_Key ?? item.id ?? index + 1),
        label: String(item.Description ?? item.Description_RU ?? item.name ?? `Запись ${index + 1}`),
        values: primitiveValues(item)
      }))
    };
  }
}

