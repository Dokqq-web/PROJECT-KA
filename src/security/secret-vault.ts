import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

interface SecretRow {
  id: string;
  name: string;
  owner_id: string;
  iv: string;
  tag: string;
  ciphertext: string;
  created_at: string;
  updated_at: string;
}

export class SecretVault {
  private readonly database: DatabaseSync;
  private readonly key?: Buffer;

  constructor(databasePath = resolve("data", "qa-bot.db")) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const encoded = process.env.SECRET_MASTER_KEY;
    if (encoded) {
      const decoded = Buffer.from(encoded, "base64");
      if (decoded.length !== 32) {
        throw new Error("SECRET_MASTER_KEY должен быть 32-байтным ключом в base64");
      }
      this.key = decoded;
    }
  }

  get available(): boolean {
    return Boolean(this.key);
  }

  create(name: string, value: string, ownerId: string): { id: string; name: string } {
    const encrypted = this.encrypt(value);
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO secrets (
          id, name, owner_id, iv, tag, ciphertext, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        name.trim(),
        ownerId,
        encrypted.iv,
        encrypted.tag,
        encrypted.ciphertext,
        timestamp,
        timestamp
      );
    return { id, name: name.trim() };
  }

  list(ownerId?: string): Array<{ id: string; name: string; ownerId: string }> {
    const rows = ownerId
      ? (this.database
          .prepare("SELECT * FROM secrets WHERE owner_id = ? ORDER BY name")
          .all(ownerId) as unknown as SecretRow[])
      : (this.database
          .prepare("SELECT * FROM secrets ORDER BY name")
          .all() as unknown as SecretRow[]);
    return rows.map((row) => ({ id: row.id, name: row.name, ownerId: row.owner_id }));
  }

  read(id: string): string | undefined {
    const row = this.database
      .prepare("SELECT * FROM secrets WHERE id = ?")
      .get(id) as unknown as SecretRow | undefined;
    if (!row) return undefined;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.requiredKey(),
      Buffer.from(row.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(row.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(row.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  }

  remove(id: string): boolean {
    return Number(
      this.database.prepare("DELETE FROM secrets WHERE id = ?").run(id).changes
    ) > 0;
  }

  private encrypt(value: string): { iv: string; tag: string; ciphertext: string } {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.requiredKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final()
    ]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
  }

  private requiredKey(): Buffer {
    if (!this.key) throw new Error("Хранилище секретов не настроено");
    return this.key;
  }
}

