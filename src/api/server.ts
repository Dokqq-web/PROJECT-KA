import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestCase, TestStepAction } from "../domain/test-case.js";
import { PlaywrightRunner } from "../runners/playwright-runner.js";
import { RunService } from "../services/run-service.js";
import { SqliteRunRepository } from "../repositories/sqlite-run-repository.js";
import { SqliteTestCaseRepository } from "../repositories/sqlite-test-case-repository.js";
import { TestCaseService } from "../services/test-case-service.js";
import { TestSuiteService } from "../services/test-suite-service.js";
import {
  TestCaseImportService,
  type ImportFormat
} from "../services/test-case-import-service.js";
import { YouTrackConnector } from "../connectors/youtrack-connector.js";
import { JiraConnector } from "../connectors/jira-connector.js";
import { KaitenConnector } from "../connectors/kaiten-connector.js";
import { OneCDataConnector } from "../connectors/one-c-data-connector.js";
import { Bitrix24DataConnector } from "../connectors/bitrix24-data-connector.js";
import { AmoCrmDataConnector } from "../connectors/amocrm-data-connector.js";
import { SqliteScheduleRepository } from "../repositories/sqlite-schedule-repository.js";
import { ScheduleService } from "../services/schedule-service.js";
import {
  AuthService,
  canWrite,
  roleValue,
  type Principal
} from "../security/auth-service.js";
import { SecretVault } from "../security/secret-vault.js";
import { AuditService } from "../security/audit-service.js";
import { SqliteDeviceRepository } from "../repositories/sqlite-device-repository.js";
import { SqliteTestSuiteRepository } from "../repositories/sqlite-test-suite-repository.js";
import { DeviceService } from "../services/device-service.js";
import { MobileRunner } from "../runners/mobile-runner.js";
import { PlatformRunner } from "../runners/platform-runner.js";
import {
  ResultPublisher,
  type PublishSystem
} from "../connectors/result-publisher.js";
import {
  MetricsService,
  normalizeRoute
} from "../operations/metrics-service.js";
import { NotificationService } from "../services/notification-service.js";
import { MaintenanceService } from "../services/maintenance-service.js";
import { MigrationService } from "../database/migration-service.js";
import { FileStorageService } from "../services/file-storage-service.js";
import { ReportService } from "../services/report-service.js";
import { SettingsService } from "../services/settings-service.js";
import { logEvent } from "../operations/logger.js";

const port = Number(process.env.API_PORT ?? 8080);
const databasePath = process.env.DATABASE_PATH;
const concurrency = Math.max(1, Number(process.env.RUN_CONCURRENCY ?? 2) || 2);
const auth = new AuthService(databasePath);
const vault = new SecretVault(databasePath);
const settings = new SettingsService(databasePath);
const devices = new DeviceService(new SqliteDeviceRepository(databasePath));
const notifications = new NotificationService(
  process.env,
  fetch,
  managedNotificationConfig
);
const files = new FileStorageService();
const reports = new ReportService();
const runRepository = new SqliteRunRepository(databasePath);
const service = new RunService(
  new PlatformRunner(new PlaywrightRunner(), new MobileRunner(devices)),
  runRepository,
  concurrency,
  (run) => notifications.notifyRunCompleted(run)
);
const testCases = new TestCaseService(new SqliteTestCaseRepository(databasePath));
const suites = new TestSuiteService(
  new SqliteTestSuiteRepository(databasePath),
  testCases,
  service
);
const schedules = new ScheduleService(
  new SqliteScheduleRepository(databasePath),
  testCases,
  service,
  suites
);
const importer = new TestCaseImportService(testCases);
const youTrack = new YouTrackConnector();
const jira = new JiraConnector();
const kaiten = new KaitenConnector();
const oneCData = new OneCDataConnector();
const bitrix24Data = new Bitrix24DataConnector();
const amoCrmData = new AmoCrmDataConnector();
const audit = new AuditService(databasePath);
const maintenance = new MaintenanceService(
  runRepository,
  audit,
  process.env.ARTIFACTS_DIRECTORY
);
const retentionDays = Number(process.env.RETENTION_DAYS);
if (Number.isInteger(retentionDays) && retentionDays > 0) {
  maintenance.start(retentionDays);
}
const metrics = new MetricsService();
const migrations = new MigrationService(databasePath);
migrations.apply();
const resultPublisher = new ResultPublisher();
const dashboardDirectory = fileURLToPath(new URL("../../dashboard/", import.meta.url));
const allowedActions = new Set<TestStepAction>([
  "open",
  "click",
  "fill",
  "select",
  "assertText",
  "assertVisible",
  "wait",
  "apiRequest",
  "assertJson",
  "if",
  "repeat",
  "setFrame",
  "resetFrame",
  "clickNewTab",
  "switchTab",
  "uploadFile",
  "download",
  "mockRoute",
  "clearMocks",
  "screenshot",
  "hover",
  "press",
  "check",
  "uncheck",
  "assertValue",
  "assertUrl",
  "assertCount",
  "assertAttribute",
  "assertScreenshot"
]);

const server = createServer(async (request, response) => {
  setCorsHeaders(response);
  const requestId = requestIdValue(request.headers["x-request-id"]);
  const startedAt = performance.now();
  response.setHeader("x-request-id", requestId);
  response.once("finish", () => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    metrics.observe(
      request.method ?? "UNKNOWN",
      normalizeRoute(path),
      response.statusCode,
      performance.now() - startedAt
    );
    logEvent("info", "http.request.completed", {
      requestId,
      method: request.method ?? "UNKNOWN",
      path: normalizeRoute(path),
      statusCode: response.statusCode,
      durationMs: Number((performance.now() - startedAt).toFixed(2))
    });
  });

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const isPublic =
      request.method === "GET" &&
      ["/", "/app.js", "/styles.css", "/health", "/ready"].includes(url.pathname);
    const principal = auth.authenticate(extractApiKey(request));
    if (!isPublic) {
      response.once("finish", () => {
        audit.record({
          principal,
          method: request.method ?? "UNKNOWN",
          path: url.pathname,
          statusCode: response.statusCode,
          remoteAddress: request.socket.remoteAddress
        });
      });
    }
    if (!isPublic && !principal) {
      sendJson(response, 401, { error: "Authentication required" });
      return;
    }
    if (
      !isPublic &&
      request.method !== "GET" &&
      principal &&
      !canWrite(principal)
    ) {
      sendJson(response, 403, { error: "Editor or admin role required" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      await sendFile(response, "index.html", "text/html; charset=utf-8");
      return;
    }

    if (request.method === "POST" && url.pathname === "/connectors/jira/import") {
      const body = await readConnectorBody(request);
      const result = await jira.import({
        mode: body.mode,
        baseUrl: stringValue(body.baseUrl),
        email: stringValue(body.email),
        token: secretOrValue(body, "token", principal!),
        query: stringValue(body.query)
      });
      sendConnectorResult(response, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/data/1c/fetch") {
      const body = await readConnectorBody(request);
      sendJson(response, 200, await oneCData.fetch({
        mode: body.mode,
        baseUrl: stringValue(body.baseUrl),
        username: stringValue(body.username),
        password: secretOrValue(body, "password", principal!),
        entity: stringValue(body.entity),
        filter: stringValue(body.filter)
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/data/bitrix24/fetch") {
      const body = await readConnectorBody(request);
      sendJson(response, 200, await bitrix24Data.fetch({
        mode: body.mode,
        webhookUrl: secretOrValue(body, "webhookUrl", principal!),
        entityTypeId:
          typeof body.entityTypeId === "number" ? body.entityTypeId : undefined
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/data/amocrm/fetch") {
      const body = await readConnectorBody(request);
      sendJson(response, 200, await amoCrmData.fetch({
        mode: body.mode,
        baseUrl: stringValue(body.baseUrl),
        accessToken: secretOrValue(body, "accessToken", principal!),
        query: stringValue(body.query)
      }));
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/connectors/kaiten/import"
    ) {
      const body = await readConnectorBody(request);
      const result = await kaiten.import({
        mode: body.mode,
        baseUrl: stringValue(body.baseUrl),
        token: secretOrValue(body, "token", principal!),
        query: stringValue(body.query)
      });
      sendConnectorResult(response, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/app.js") {
      await sendFile(response, "app.js", "text/javascript; charset=utf-8");
      return;
    }

    if (request.method === "GET" && url.pathname === "/styles.css") {
      await sendFile(response, "styles.css", "text/css; charset=utf-8");
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        status: "ok",
        requestId,
        uptimeSeconds: Math.floor(process.uptime()),
        authRequired: auth.required
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/ready") {
      try {
        service.queueState();
        testCases.list();
        sendJson(response, 200, { status: "ready", requestId });
      } catch {
        sendJson(response, 503, { status: "not_ready", requestId });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/me") {
      sendJson(response, 200, principal);
      return;
    }

    if (request.method === "GET" && url.pathname === "/audit") {
      if (principal?.role !== "admin") {
        sendJson(response, 403, { error: "Admin role required" });
        return;
      }
      sendJson(
        response,
        200,
        audit.list({
          limit: numberParameter(url, "limit"),
          method: url.searchParams.get("method") ?? undefined,
          statusCode: numberParameter(url, "status"),
          principalId: url.searchParams.get("principalId") ?? undefined,
          from: dateParameter(url, "from"),
          to: dateParameter(url, "to")
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/metrics") {
      if (principal?.role !== "admin") {
        sendJson(response, 403, { error: "Admin role required" });
        return;
      }
      sendText(
        response,
        200,
        metrics.render(service.queueState()),
        "text/plain; version=0.0.4; charset=utf-8"
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/notifications") {
      if (principal?.role !== "admin") {
        sendJson(response, 403, { error: "Admin role required" });
        return;
      }
      sendJson(response, 200, notifications.status());
      return;
    }

    if (request.method === "POST" && url.pathname === "/notifications/test") {
      if (principal?.role !== "admin") {
        sendJson(response, 403, { error: "Admin role required" });
        return;
      }
      const result = await notifications.sendTest();
      sendJson(response, result.attempted > 0 ? 200 : 503, result);
      return;
    }

    if (request.method === "PUT" && url.pathname === "/notifications/config") {
      if (principal?.role !== "admin") {
        sendJson(response, 403, { error: "Admin role required" });
        return;
      }
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.secretId !== "string") {
        sendJson(response, 400, { error: "secretId is required" });
        return;
      }
      if (body.secretId) {
        const raw = vault.read(body.secretId, principal.id, true);
        if (!raw) throw new Error("Секрет конфигурации не найден");
        validateNotificationConfig(raw);
      }
      settings.set("notification_secret_id", body.secretId);
      sendJson(response, 200, notifications.status());
      return;
    }

    if (request.method === "GET" && url.pathname === "/maintenance") {
      if (principal?.role !== "admin") {
        sendJson(response, 403, { error: "Admin role required" });
        return;
      }
      sendJson(response, 200, {
        automaticCleanup: Number.isInteger(retentionDays) && retentionDays > 0,
        retentionDays:
          Number.isInteger(retentionDays) && retentionDays > 0
            ? retentionDays
            : null,
        migrations: migrations.status()
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/maintenance/cleanup") {
      if (principal?.role !== "admin") {
        sendJson(response, 403, { error: "Admin role required" });
        return;
      }
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.retentionDays !== "number") {
        sendJson(response, 400, { error: "retentionDays is required" });
        return;
      }
      sendJson(
        response,
        200,
        await maintenance.cleanup(body.retentionDays, body.dryRun === true)
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/devices") {
      sendJson(response, 200, devices.list());
      return;
    }

    if (request.method === "POST" && url.pathname === "/files") {
      const body = await readJson(request);
      if (
        !isRecord(body) ||
        typeof body.name !== "string" ||
        typeof body.contentBase64 !== "string"
      ) {
        sendJson(response, 400, { error: "name and contentBase64 are required" });
        return;
      }
      sendJson(response, 201, files.create(body.name, body.contentBase64));
      return;
    }

    if (request.method === "POST" && url.pathname === "/devices") {
      const body = await readJson(request);
      if (
        !isRecord(body) ||
        typeof body.name !== "string" ||
        (body.platform !== "android" && body.platform !== "ios") ||
        typeof body.appiumEndpoint !== "string" ||
        !isRecord(body.capabilities)
      ) {
        sendJson(response, 400, {
          error: "name, platform, appiumEndpoint and capabilities are required"
        });
        return;
      }
      sendJson(response, 201, devices.create({
        name: body.name,
        platform: body.platform,
        appiumEndpoint: body.appiumEndpoint,
        capabilities: body.capabilities
      }));
      return;
    }

    const disableDeviceMatch = url.pathname.match(
      /^\/devices\/([a-f0-9-]+)\/disable$/i
    );
    if (request.method === "POST" && disableDeviceMatch) {
      const device = devices.disable(disableDeviceMatch[1]!);
      sendJson(response, device ? 200 : 404, device ?? { error: "Device not found" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/auth/keys") {
      if (principal?.role !== "admin") {
        sendJson(response, 403, { error: "Admin role required" });
        return;
      }
      sendJson(response, 200, auth.listKeys());
      return;
    }

    if (request.method === "POST" && url.pathname === "/auth/keys") {
      if (principal?.role !== "admin") {
        sendJson(response, 403, { error: "Admin role required" });
        return;
      }
      const body = await readJson(request);
      const role = isRecord(body) ? roleValue(body.role) : undefined;
      if (!isRecord(body) || typeof body.name !== "string" || !role) {
        sendJson(response, 400, { error: "name and valid role are required" });
        return;
      }
      sendJson(response, 201, auth.createKey(body.name, role));
      return;
    }

    const revokeKeyMatch = url.pathname.match(/^\/auth\/keys\/([a-f0-9-]+)\/revoke$/i);
    if (request.method === "POST" && revokeKeyMatch) {
      if (principal?.role !== "admin") {
        sendJson(response, 403, { error: "Admin role required" });
        return;
      }
      sendJson(response, auth.revokeKey(revokeKeyMatch[1]!) ? 200 : 404, {
        revoked: true
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/secrets") {
      if (!vault.available) {
        sendJson(response, 503, { error: "Secret vault is not configured" });
        return;
      }
      sendJson(
        response,
        200,
        vault.list(principal?.role === "admin" ? undefined : principal?.id)
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/secrets") {
      if (!vault.available) {
        sendJson(response, 503, { error: "Secret vault is not configured" });
        return;
      }
      const body = await readJson(request);
      if (
        !isRecord(body) ||
        typeof body.name !== "string" ||
        typeof body.value !== "string"
      ) {
        sendJson(response, 400, { error: "name and value are required" });
        return;
      }
      sendJson(response, 201, vault.create(body.name, body.value, principal!.id));
      return;
    }

    const removeSecretMatch = url.pathname.match(/^\/secrets\/([a-f0-9-]+)\/remove$/i);
    if (request.method === "POST" && removeSecretMatch) {
      const removed = vault.remove(
        removeSecretMatch[1]!,
        principal!.id,
        principal!.role === "admin"
      );
      sendJson(
        response,
        removed ? 200 : 404,
        { removed }
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/runs") {
      const body = await readJson(request);
      const errors = validateTestCase(body);
      if (errors.length > 0) {
        sendJson(response, 400, { error: "Invalid test case", details: errors });
        return;
      }

      const record = service.create(body as unknown as TestCase);
      sendJson(response, 202, {
        id: record.id,
        status: record.status,
        statusUrl: `/runs/${record.id}`
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/test-cases") {
      sendJson(response, 200, testCases.list());
      return;
    }

    if (request.method === "GET" && url.pathname === "/test-suites") {
      sendJson(response, 200, suites.list());
      return;
    }

    if (request.method === "POST" && url.pathname === "/test-suites") {
      const body = await readJson(request);
      if (
        !isRecord(body) ||
        typeof body.name !== "string" ||
        !Array.isArray(body.testCaseIds) ||
        !body.testCaseIds.every((id) => typeof id === "string")
      ) {
        sendJson(response, 400, { error: "name and testCaseIds are required" });
        return;
      }
      sendJson(response, 201, suites.create(body.name, body.testCaseIds));
      return;
    }

    const suiteMatch = url.pathname.match(/^\/test-suites\/([a-f0-9-]+)$/i);
    if (request.method === "PUT" && suiteMatch) {
      const body = await readJson(request);
      if (
        !isRecord(body) ||
        typeof body.name !== "string" ||
        !Array.isArray(body.testCaseIds) ||
        !body.testCaseIds.every((id) => typeof id === "string")
      ) {
        sendJson(response, 400, { error: "name and testCaseIds are required" });
        return;
      }
      const record = suites.update(
        suiteMatch[1]!,
        body.name,
        body.testCaseIds
      );
      sendJson(
        response,
        record ? 200 : 404,
        record ?? { error: "Набор тестов не найден" }
      );
      return;
    }

    if (request.method === "DELETE" && suiteMatch) {
      const deleted = suites.delete(suiteMatch[1]!);
      sendJson(response, deleted ? 200 : 404, { deleted });
      return;
    }

    const suiteRunMatch = url.pathname.match(
      /^\/test-suites\/([a-f0-9-]+)\/runs$/i
    );
    if (request.method === "POST" && suiteRunMatch) {
      const record = suites.run(suiteRunMatch[1]!);
      sendJson(response, 202, {
        ...record,
        statusUrl: `/test-suite-runs/${record.id}`
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/test-suite-runs") {
      sendJson(response, 200, suites.listRuns());
      return;
    }

    const suiteRunStatusMatch = url.pathname.match(
      /^\/test-suite-runs\/([a-f0-9-]+)$/i
    );
    if (request.method === "GET" && suiteRunStatusMatch) {
      const record = suites.getRun(suiteRunStatusMatch[1]!);
      sendJson(
        response,
        record ? 200 : 404,
        record ?? { error: "Запуск набора не найден" }
      );
      return;
    }

    const suiteRetryMatch = url.pathname.match(
      /^\/test-suite-runs\/([a-f0-9-]+)\/retry-failed$/i
    );
    if (request.method === "POST" && suiteRetryMatch) {
      const record = suites.retryFailed(suiteRetryMatch[1]!);
      sendJson(response, 202, {
        ...record,
        statusUrl: `/test-suite-runs/${record.id}`
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/test-cases") {
      const body = await readJson(request);
      const errors = validateTestCase(body);
      if (errors.length > 0) {
        sendJson(response, 400, { error: "Invalid test case", details: errors });
        return;
      }
      sendJson(response, 201, testCases.create(body as unknown as TestCase));
      return;
    }

    if (request.method === "POST" && url.pathname === "/test-cases/import") {
      const body = await readJson(request);
      if (
        !isRecord(body) ||
        (body.format !== "json" && body.format !== "csv") ||
        typeof body.content !== "string"
      ) {
        sendJson(response, 400, {
          error: "Body must contain format=json|csv and string content"
        });
        return;
      }
      const result = importer.import(body.format as ImportFormat, body.content);
      sendJson(
        response,
        result.imported.length > 0 ? 201 : 400,
        {
          importedCount: result.imported.length,
          imported: result.imported,
          errors: result.errors
        }
      );
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/connectors/youtrack/import"
    ) {
      const body = await readJson(request);
      if (
        !isRecord(body) ||
        (body.mode !== "demo" && body.mode !== "live")
      ) {
        sendJson(response, 400, { error: "mode must be demo or live" });
        return;
      }

      const result = await youTrack.import({
        mode: body.mode,
        baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
        token: secretOrValue(body, "token", principal!),
        query: typeof body.query === "string" ? body.query : undefined
      });
      const imported = result.testCases.map((testCase) =>
        testCases.create(testCase)
      );
      sendJson(response, imported.length > 0 ? 201 : 400, {
        issuesRead: result.issuesRead,
        importedCount: imported.length,
        imported,
        errors: result.errors
      });
      return;
    }

    const testCaseMatch = url.pathname.match(/^\/test-cases\/([a-f0-9-]+)$/i);
    if (request.method === "GET" && testCaseMatch) {
      const record = testCases.get(testCaseMatch[1]!);
      if (!record) {
        sendJson(response, 404, { error: "Test case not found" });
        return;
      }
      sendJson(response, 200, record);
      return;
    }

    if (request.method === "PUT" && testCaseMatch) {
      const body = await readJson(request);
      const errors = validateTestCase(body);
      if (errors.length > 0) {
        sendJson(response, 400, { error: "Invalid test case", details: errors });
        return;
      }
      const record = testCases.update(
        testCaseMatch[1]!,
        body as unknown as TestCase
      );
      if (!record) {
        sendJson(response, 404, { error: "Test case not found" });
        return;
      }
      sendJson(response, 200, record);
      return;
    }

    const copyMatch = url.pathname.match(/^\/test-cases\/([a-f0-9-]+)\/copy$/i);
    if (request.method === "POST" && copyMatch) {
      const record = testCases.copy(copyMatch[1]!);
      if (!record) {
        sendJson(response, 404, { error: "Test case not found" });
        return;
      }
      sendJson(response, 201, record);
      return;
    }

    const savedRunMatch = url.pathname.match(
      /^\/test-cases\/([a-f0-9-]+)\/runs$/i
    );
    if (request.method === "POST" && savedRunMatch) {
      const saved = testCases.get(savedRunMatch[1]!);
      if (!saved) {
        sendJson(response, 404, { error: "Test case not found" });
        return;
      }
      const record = service.create(saved.testCase);
      sendJson(response, 202, {
        id: record.id,
        status: record.status,
        statusUrl: `/runs/${record.id}`
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/runs") {
      sendJson(response, 200, service.list());
      return;
    }

    if (request.method === "GET" && url.pathname === "/queue") {
      sendJson(response, 200, service.queueState());
      return;
    }

    const cancelRunMatch = url.pathname.match(/^\/runs\/([a-f0-9-]+)\/cancel$/i);
    if (request.method === "POST" && cancelRunMatch) {
      const record = service.cancel(cancelRunMatch[1]!);
      if (!record) {
        sendJson(response, 404, { error: "Run not found" });
        return;
      }
      sendJson(response, 200, record);
      return;
    }

    const publishMatch = url.pathname.match(
      /^\/runs\/([a-f0-9-]+)\/publish\/(jira|youtrack|kaiten)$/i
    );
    if (request.method === "POST" && publishMatch) {
      const run = service.get(publishMatch[1]!);
      if (!run) {
        sendJson(response, 404, { error: "Run not found" });
        return;
      }
      const body = await readConnectorBody(request);
      sendJson(
        response,
        200,
        await resultPublisher.publish(
          publishMatch[2]!.toLowerCase() as PublishSystem,
          run,
          {
            mode: body.mode,
            baseUrl: stringValue(body.baseUrl),
            token: secretOrValue(body, "token", principal!),
            email: stringValue(body.email)
          }
        )
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/schedules") {
      sendJson(response, 200, schedules.list());
      return;
    }

    if (request.method === "GET" && url.pathname === "/schedule-triggers") {
      sendJson(
        response,
        200,
        schedules.triggers(url.searchParams.get("scheduleId") ?? undefined)
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/schedules") {
      const body = await readJson(request);
      if (
        !isRecord(body) ||
        !(
          typeof body.targetId === "string" ||
          typeof body.testCaseId === "string"
        ) ||
        !(
          typeof body.runAt === "string" ||
          typeof body.cronExpression === "string"
        )
      ) {
        sendJson(response, 400, {
          error: "targetId/testCaseId and runAt/cronExpression are required"
        });
        return;
      }
      const record = schedules.create({
        name: typeof body.name === "string" ? body.name : "",
        testCaseId:
          typeof body.testCaseId === "string" ? body.testCaseId : undefined,
        targetType: body.targetType === "suite" ? "suite" : "testCase",
        targetId:
          typeof body.targetId === "string" ? body.targetId : undefined,
        runAt: typeof body.runAt === "string" ? body.runAt : undefined,
        repeatMinutes:
          typeof body.repeatMinutes === "number" ? body.repeatMinutes : undefined,
        cronExpression:
          typeof body.cronExpression === "string"
            ? body.cronExpression
            : undefined,
        timezone: typeof body.timezone === "string" ? body.timezone : undefined,
        overlapPolicy: body.overlapPolicy === "skip" ? "skip" : "queue"
      });
      sendJson(response, 201, record);
      return;
    }

    const cancelScheduleMatch = url.pathname.match(
      /^\/schedules\/([a-f0-9-]+)\/cancel$/i
    );
    if (request.method === "POST" && cancelScheduleMatch) {
      const record = schedules.cancel(cancelScheduleMatch[1]!);
      if (!record) {
        sendJson(response, 404, { error: "Schedule not found" });
        return;
      }
      sendJson(response, 200, record);
      return;
    }

    const runMatch = url.pathname.match(/^\/runs\/([a-f0-9-]+)$/i);
    if (request.method === "GET" && runMatch) {
      const record = service.get(runMatch[1]!);
      if (!record) {
        sendJson(response, 404, { error: "Run not found" });
        return;
      }
      sendJson(response, 200, record);
      return;
    }

    const reportMatch = url.pathname.match(
      /^\/runs\/([a-f0-9-]+)\/report\/(json|html|junit)$/i
    );
    if (request.method === "GET" && reportMatch) {
      const record = service.get(reportMatch[1]!);
      if (!record) {
        sendJson(response, 404, { error: "Run not found" });
        return;
      }
      const format = reportMatch[2]!.toLowerCase();
      response.setHeader(
        "content-disposition",
        `attachment; filename="run-${record.id}.${format === "junit" ? "xml" : format}"`
      );
      if (format === "json") {
        sendJson(response, 200, record);
      } else if (format === "html") {
        sendText(response, 200, reports.html(record), "text/html; charset=utf-8");
      } else {
        sendText(
          response,
          200,
          reports.junit(record),
          "application/xml; charset=utf-8"
        );
      }
      return;
    }

    const artifactMatch = url.pathname.match(
      /^\/runs\/([a-f0-9-]+)\/artifacts\/([^/]+)\/(\d+)$/i
    );
    if (request.method === "GET" && artifactMatch) {
      const record = service.get(artifactMatch[1]!);
      const step = record?.result?.steps.find(
        (item) => item.stepId === decodeURIComponent(artifactMatch[2]!)
      );
      const artifact = step?.artifacts?.[Number(artifactMatch[3]!)];
      if (!artifact) {
        sendJson(response, 404, { error: "Artifact not found" });
        return;
      }
      await sendArtifact(response, artifact);
      return;
    }

    sendJson(response, 404, { error: "Route not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, message === "Request body is too large" ? 413 : 400, {
      error: message
    });
  }
});

server.listen(port, () => {
  console.log(`QA Bot API: http://localhost:${port}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`Received ${signal}, stopping QA Bot API`);
    const forcedExit = setTimeout(() => process.exit(1), 10_000);
    forcedExit.unref();
    server.close(() => {
      schedules.close();
      maintenance.close();
      audit.close();
      runRepository.close();
      migrations.close();
      settings.close();
      vault.close();
      auth.close();
      process.exit(0);
    });
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    const limit = Number(process.env.MAX_REQUEST_BODY_BYTES ?? 8_000_000);
    if (size > limit) throw new Error("Request body is too large");
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) throw new Error("Request body is required");
  return JSON.parse(text);
}

function validateTestCase(value: unknown): string[] {
  if (!isRecord(value)) return ["Body must be a JSON object"];

  const errors: string[] = [];
  if (!nonEmptyString(value.id)) errors.push("id is required");
  if (!nonEmptyString(value.name)) errors.push("name is required");
  if (!["web", "android", "ios"].includes(String(value.platform))) {
    errors.push("platform must be web, android or ios");
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    errors.push("steps must be a non-empty array");
    return errors;
  }

  value.steps.forEach((step, index) => {
    if (!isRecord(step)) {
      errors.push(`steps[${index}] must be an object`);
      return;
    }
    if (!nonEmptyString(step.id)) errors.push(`steps[${index}].id is required`);
    if (!nonEmptyString(step.action) || !allowedActions.has(step.action as TestStepAction)) {
      errors.push(`steps[${index}].action is not supported`);
    }
  });
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

function sendText(
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string
): void {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader(
    "access-control-allow-methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  response.setHeader(
    "access-control-allow-headers",
    "content-type, authorization, x-api-key, x-request-id"
  );
  response.setHeader("access-control-expose-headers", "x-request-id");
}

function requestIdValue(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[a-zA-Z0-9._-]{1,100}$/.test(candidate)
    ? candidate
    : randomUUID();
}

function extractApiKey(request: IncomingMessage): string | undefined {
  const direct = request.headers["x-api-key"];
  if (typeof direct === "string" && direct) return direct;
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  return undefined;
}

async function readConnectorBody(
  request: IncomingMessage
): Promise<Record<string, unknown> & { mode: "demo" | "live" }> {
  const body = await readJson(request);
  if (!isRecord(body) || (body.mode !== "demo" && body.mode !== "live")) {
    throw new Error("mode must be demo or live");
  }
  return body as Record<string, unknown> & { mode: "demo" | "live" };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function secretOrValue(
  body: Record<string, unknown>,
  key: string,
  principal: Principal
): string | undefined {
  const secretId = body[`${key}SecretId`];
  if (typeof secretId === "string" && secretId) {
    const value = vault.read(
      secretId,
      principal.id,
      principal.role === "admin"
    );
    if (value === undefined) {
      throw new Error(`Секрет для поля ${key} не найден или недоступен`);
    }
    return value;
  }
  return stringValue(body[key]);
}

function managedNotificationConfig(): {
  webhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  notifyOn?: "always" | "failure";
} | undefined {
  const secretId = settings.get("notification_secret_id");
  if (!secretId) return undefined;
  const raw = vault.read(secretId, undefined, true);
  if (!raw) return undefined;
  try {
    return validateNotificationConfig(raw);
  } catch (error) {
    console.error("Managed notification configuration is invalid:", error);
    return undefined;
  }
}

function validateNotificationConfig(raw: string): {
  webhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  notifyOn?: "always" | "failure";
} {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) {
    throw new Error("Секрет уведомлений должен содержать JSON-объект");
  }
  const configuration: {
    webhookUrl?: string;
    telegramBotToken?: string;
    telegramChatId?: string;
    notifyOn?: "always" | "failure";
  } = {
    webhookUrl: stringValue(value.webhookUrl),
    telegramBotToken: stringValue(value.telegramBotToken),
    telegramChatId: stringValue(value.telegramChatId),
    notifyOn:
      value.notifyOn === "failure" || value.notifyOn === "always"
        ? value.notifyOn
        : undefined
  };
  if (
    !configuration.webhookUrl &&
    !(configuration.telegramBotToken && configuration.telegramChatId)
  ) {
    throw new Error(
      "Нужен webhookUrl либо telegramBotToken вместе с telegramChatId"
    );
  }
  return configuration;
}

function sendConnectorResult(
  response: ServerResponse,
  result: {
    testCases: TestCase[];
    errors: string[];
    issuesRead: number;
  }
): void {
  const imported = result.testCases.map((testCase) => testCases.create(testCase));
  sendJson(response, imported.length > 0 ? 201 : 400, {
    issuesRead: result.issuesRead,
    importedCount: imported.length,
    imported,
    errors: result.errors
  });
}

function numberParameter(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  if (value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Query parameter ${name} must be a number`);
  }
  return number;
}

function dateParameter(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Query parameter ${name} must be an ISO date`);
  }
  return date.toISOString();
}

async function sendFile(
  response: ServerResponse,
  name: string,
  contentType: string
): Promise<void> {
  const body = await readFile(`${dashboardDirectory}/${name}`);
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  response.end(body);
}

async function sendArtifact(response: ServerResponse, filePath: string): Promise<void> {
  const root = resolve(process.env.ARTIFACTS_DIRECTORY ?? "artifacts");
  const target = resolve(filePath);
  if (!target.startsWith(`${root}${sep}`)) {
    sendJson(response, 403, { error: "Artifact path is outside storage" });
    return;
  }
  const info = await stat(target).catch(() => undefined);
  if (!info) {
    sendJson(response, 404, { error: "Artifact not found" });
    return;
  }
  if (!info.isFile()) {
    sendJson(response, 404, { error: "Artifact not found" });
    return;
  }
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".json": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".html": "text/html; charset=utf-8"
  };
  response.writeHead(200, {
    "content-type": types[extname(target).toLowerCase()] ?? "application/octet-stream",
    "content-length": info.size,
    "content-disposition": `inline; filename="${basename(target).replaceAll("\"", "")}"`
  });
  createReadStream(target).pipe(response);
}
