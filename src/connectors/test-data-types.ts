export interface TestDataRecord {
  id: string;
  label: string;
  values: Record<string, string>;
}

export interface TestDataResult {
  source: "1c" | "bitrix24" | "amocrm";
  records: TestDataRecord[];
}

export function primitiveValues(
  value: Record<string, unknown>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) =>
        ["string", "number", "boolean"].includes(typeof field)
      )
      .map(([key, field]) => [key, String(field)])
  );
}

export function checkedHttpUrl(value: string, system: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Адрес ${system} должен использовать HTTP или HTTPS`);
  }
  return url;
}

