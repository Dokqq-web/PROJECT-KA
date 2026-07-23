export interface DataProvider {
  get(name: string, parameters?: Record<string, string>): Promise<unknown>;
}

