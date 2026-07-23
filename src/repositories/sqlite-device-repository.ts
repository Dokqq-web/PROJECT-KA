import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DeviceRecord, DeviceRepository } from "./device-repository.js";

interface Row {
  id: string;
  name: string;
  platform: "android" | "ios";
  appium_endpoint: string;
  capabilities_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export class SqliteDeviceRepository implements DeviceRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath = resolve("data", "qa-bot.db")) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
        appium_endpoint TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  create(record: DeviceRecord): void {
    this.database
      .prepare(`
        INSERT INTO devices (
          id, name, platform, appium_endpoint, capabilities_json, enabled,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(...parameters(record));
  }

  get(id: string): DeviceRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(id) as unknown as Row | undefined;
    return row ? fromRow(row) : undefined;
  }

  list(): DeviceRecord[] {
    return (
      this.database.prepare("SELECT * FROM devices ORDER BY name").all() as unknown as Row[]
    ).map(fromRow);
  }

  update(record: DeviceRecord): void {
    this.database
      .prepare(`
        UPDATE devices
        SET name = ?, platform = ?, appium_endpoint = ?, capabilities_json = ?,
            enabled = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        record.name,
        record.platform,
        record.appiumEndpoint,
        JSON.stringify(record.capabilities),
        record.enabled ? 1 : 0,
        record.updatedAt,
        record.id
      );
  }
}

function parameters(record: DeviceRecord): Array<string | number> {
  return [
    record.id,
    record.name,
    record.platform,
    record.appiumEndpoint,
    JSON.stringify(record.capabilities),
    record.enabled ? 1 : 0,
    record.createdAt,
    record.updatedAt
  ];
}

function fromRow(row: Row): DeviceRecord {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    appiumEndpoint: row.appium_endpoint,
    capabilities: JSON.parse(row.capabilities_json),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

