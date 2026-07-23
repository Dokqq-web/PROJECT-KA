import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export async function assertSafeExternalUrl(
  input: string | URL,
  environment: NodeJS.ProcessEnv = process.env
): Promise<URL> {
  const url = input instanceof URL ? input : new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Внешний адрес должен использовать HTTP или HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Учётные данные запрещены в URL");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allowlist = (environment.OUTBOUND_HOST_ALLOWLIST ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const explicitlyAllowed = allowlist.some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`)
  );
  if (allowlist.length > 0 && !explicitlyAllowed) {
    throw new Error(`Хост ${hostname} отсутствует в OUTBOUND_HOST_ALLOWLIST`);
  }
  if (explicitlyAllowed || environment.ALLOW_PRIVATE_NETWORKS === "true") {
    return url;
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Локальные адреса запрещены политикой исходящих соединений");
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`Приватный адрес ${hostname} запрещён политикой исходящих соединений`);
  }
  return url;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:")) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped ?? (isIP(normalized) === 4 ? normalized : undefined);
  if (!ipv4) return false;
  const [a = 0, b = 0] = ipv4.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}
