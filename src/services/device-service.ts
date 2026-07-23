import { randomUUID } from "node:crypto";
import type { DeviceRecord, DeviceRepository } from "../repositories/device-repository.js";

export class DeviceService {
  constructor(private readonly repository: DeviceRepository) {}

  create(input: {
    name: string;
    platform: "android" | "ios";
    appiumEndpoint: string;
    capabilities: Record<string, unknown>;
  }): DeviceRecord {
    const endpoint = new URL(input.appiumEndpoint);
    if (!["http:", "https:"].includes(endpoint.protocol)) {
      throw new Error("Appium endpoint должен использовать HTTP или HTTPS");
    }
    const timestamp = new Date().toISOString();
    const record: DeviceRecord = {
      id: randomUUID(),
      name: input.name.trim(),
      platform: input.platform,
      appiumEndpoint: endpoint.toString().replace(/\/$/, ""),
      capabilities: structuredClone(input.capabilities),
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.repository.create(record);
    return record;
  }

  get(id: string): DeviceRecord | undefined {
    return this.repository.get(id);
  }

  list(): DeviceRecord[] {
    return this.repository.list();
  }

  disable(id: string): DeviceRecord | undefined {
    const record = this.repository.get(id);
    if (!record) return undefined;
    record.enabled = false;
    record.updatedAt = new Date().toISOString();
    this.repository.update(record);
    return record;
  }
}

