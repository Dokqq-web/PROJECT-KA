export interface DeviceRecord {
  id: string;
  name: string;
  platform: "android" | "ios";
  appiumEndpoint: string;
  capabilities: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceRepository {
  create(record: DeviceRecord): void;
  get(id: string): DeviceRecord | undefined;
  list(): DeviceRecord[];
  update(record: DeviceRecord): void;
}

