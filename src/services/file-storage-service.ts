import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { basename, resolve, sep } from "node:path";

export class FileStorageService {
  readonly uploadsDirectory: string;

  constructor(
    directory = process.env.UPLOADS_DIRECTORY ?? resolve("data", "uploads"),
    private readonly maxBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 5_000_000)
  ) {
    this.uploadsDirectory = resolve(directory);
    mkdirSync(this.uploadsDirectory, { recursive: true });
  }

  create(name: string, contentBase64: string): {
    id: string;
    name: string;
    size: number;
  } {
    const safeName = basename(name).replace(/[^a-zA-Z0-9_.-]/g, "_");
    if (!safeName || safeName === "." || safeName === "..") {
      throw new Error("Некорректное имя файла");
    }
    const content = Buffer.from(contentBase64, "base64");
    if (content.length === 0) throw new Error("Файл пуст");
    if (content.length > this.maxBytes) {
      throw new Error(`Размер файла превышает лимит ${this.maxBytes} байт`);
    }
    const id = `${randomUUID()}-${safeName}`;
    writeFileSync(this.resolve(id), content, { flag: "wx" });
    return { id, name: safeName, size: content.length };
  }

  resolve(id: string): string {
    if (!/^[a-f0-9-]{36}-[a-zA-Z0-9_.-]+$/.test(id)) {
      throw new Error("Некорректный file ID");
    }
    const path = resolve(this.uploadsDirectory, id);
    if (!path.startsWith(`${this.uploadsDirectory}${sep}`)) {
      throw new Error("Файл находится вне разрешённого каталога");
    }
    return path;
  }

  exists(id: string): boolean {
    try {
      return existsSync(this.resolve(id));
    } catch {
      return false;
    }
  }
}
