const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const apiKey = sessionStorage.getItem("qa-bot-api-key");
  const headers = new Headers(init.headers || {});
  if (apiKey) headers.set("x-api-key", apiKey);
  return nativeFetch(input, { ...init, headers });
};

const actions = {
  open: "Открыть страницу",
  fill: "Заполнить поле",
  click: "Нажать",
  assertVisible: "Проверить видимость",
  assertText: "Проверить текст",
  select: "Выбрать значение",
  wait: "Подождать",
  apiRequest: "API-запрос",
  assertJson: "Проверить JSON",
  if: "Условие",
  repeat: "Повторить группу",
  setFrame: "Перейти в iframe",
  resetFrame: "Выйти из iframe",
  clickNewTab: "Открыть новую вкладку",
  switchTab: "Переключить вкладку",
  uploadFile: "Загрузить файл",
  download: "Скачать файл",
  mockRoute: "Подменить API-ответ",
  clearMocks: "Очистить подмены API",
  screenshot: "Сделать скриншот"
};

const exampleSteps = [
  { action: "open", target: "/", value: "" },
  { action: "fill", target: "[name=email]", value: "${login}" },
  { action: "fill", target: "[name=password]", value: "${password}" },
  { action: "click", target: "button[type=submit]", value: "" },
  { action: "assertVisible", target: "[data-testid=dashboard]", value: "" }
];

const elements = {
  form: document.querySelector("#test-form"),
  name: document.querySelector("#test-name"),
  baseUrl: document.querySelector("#base-url"),
  variables: document.querySelector("#test-variables"),
  steps: document.querySelector("#steps"),
  template: document.querySelector("#step-template"),
  stepCount: document.querySelector("#step-count"),
  message: document.querySelector("#form-message"),
  runButton: document.querySelector("#run-button"),
  badge: document.querySelector("#run-badge"),
  empty: document.querySelector("#empty-result"),
  result: document.querySelector("#result"),
  resultStatus: document.querySelector("#result-status"),
  resultProgress: document.querySelector("#result-progress"),
  resultDuration: document.querySelector("#result-duration"),
  resultSteps: document.querySelector("#result-steps"),
  history: document.querySelector("#history-list"),
  serviceDot: document.querySelector("#service-dot"),
  serviceLabel: document.querySelector("#service-label"),
  templates: document.querySelector("#template-list"),
  libraryCount: document.querySelector("#library-count"),
  saveCase: document.querySelector("#save-case"),
  importFile: document.querySelector("#import-file"),
  importReport: document.querySelector("#import-report"),
  youTrackForm: document.querySelector("#youtrack-form"),
  youTrackReport: document.querySelector("#youtrack-report"),
  jiraForm: document.querySelector("#jira-form"),
  jiraReport: document.querySelector("#jira-report"),
  kaitenForm: document.querySelector("#kaiten-form"),
  kaitenReport: document.querySelector("#kaiten-report"),
  cancelRun: document.querySelector("#cancel-run"),
  queueState: document.querySelector("#queue-state"),
  scheduleTemplate: document.querySelector("#schedule-template"),
  scheduleList: document.querySelector("#schedule-list"),
  deviceList: document.querySelector("#device-list"),
  secretList: document.querySelector("#secret-list"),
  auditList: document.querySelector("#audit-list"),
  auditMethod: document.querySelector("#audit-method"),
  auditStatus: document.querySelector("#audit-status"),
  suiteCaseList: document.querySelector("#suite-case-list"),
  suiteList: document.querySelector("#suite-list"),
  notificationStatus: document.querySelector("#notification-status")
};
let activeTemplateId = null;
let activeRunId = null;

function addStep(step = { action: "click", target: "", value: "" }) {
  const fragment = elements.template.content.cloneNode(true);
  const row = fragment.querySelector(".step-row");
  row.querySelector(".step-action").value = step.action;
  row.querySelector(".step-target").value = step.target;
  row.querySelector(".step-value").value = step.value;
  row.querySelector(".remove-step").addEventListener("click", () => {
    row.remove();
    renumberSteps();
  });
  elements.steps.append(fragment);
  renumberSteps();
}

function renumberSteps() {
  const rows = [...elements.steps.querySelectorAll(".step-row")];
  rows.forEach((row, index) => {
    row.querySelector(".step-index").textContent = String(index + 1).padStart(2, "0");
  });
  const count = rows.length;
  elements.stepCount.textContent = `${count} ${pluralize(count, "шаг", "шага", "шагов")}`;
}

function pluralize(number, one, few, many) {
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function loadExample() {
  activeTemplateId = null;
  elements.steps.replaceChildren();
  exampleSteps.forEach(addStep);
  elements.name.value = "Успешный вход пользователя";
  elements.baseUrl.value = "http://localhost:4173";
  elements.variables.value = JSON.stringify({
    login: "qa@example.test",
    password: "testing123"
  });
}

async function saveTemplate() {
  elements.saveCase.disabled = true;
  elements.message.textContent = activeTemplateId ? "Обновляем шаблон…" : "Сохраняем шаблон…";
  try {
    const response = await fetch(
      activeTemplateId ? `/test-cases/${activeTemplateId}` : "/test-cases",
      {
        method: activeTemplateId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildTestCase())
      }
    );
    const record = await response.json();
    if (!response.ok) throw new Error(record.details?.join(", ") || record.error);
    activeTemplateId = record.id;
    elements.message.textContent = "Шаблон сохранён";
    await loadTemplates();
  } catch (error) {
    elements.message.textContent = error.message || "Не удалось сохранить шаблон";
  } finally {
    elements.saveCase.disabled = false;
  }
}

function editTemplate(record) {
  activeTemplateId = record.id;
  elements.name.value = record.testCase.name;
  elements.baseUrl.value = record.testCase.baseUrl || "";
  elements.variables.value = JSON.stringify(record.testCase.variables || {}, null, 2);
  elements.steps.replaceChildren();
  record.testCase.steps.forEach((step) =>
    addStep({
      action: step.action,
      target: step.target || "",
      value: step.value || ""
    })
  );
  elements.message.textContent = "Шаблон загружен в редактор";
  window.scrollTo({ top: document.querySelector(".editor-panel").offsetTop - 20, behavior: "smooth" });
}

async function copyTemplate(id) {
  const response = await fetch(`/test-cases/${id}/copy`, { method: "POST" });
  const record = await response.json();
  if (!response.ok) throw new Error(record.error || "Не удалось скопировать шаблон");
  await loadTemplates();
  editTemplate(record);
}

async function runTemplate(id) {
  setFormState(true, "Запускаем сохранённый шаблон…");
  const response = await fetch(`/test-cases/${id}/runs`, { method: "POST" });
  const created = await response.json();
  if (!response.ok) {
    setFormState(false, created.error || "Не удалось запустить шаблон");
    return;
  }
  await watchRun(created.id);
}

async function loadTemplates() {
  try {
    const response = await fetch("/test-cases");
    const records = await response.json();
    const selectedTemplate = elements.scheduleTemplate.value;
    elements.scheduleTemplate.replaceChildren(
      new Option("Выберите шаблон", ""),
      ...records.map((record) => new Option(record.testCase.name, record.id))
    );
    elements.scheduleTemplate.value = selectedTemplate;
    elements.suiteCaseList.replaceChildren(
      ...records.map((record) => {
        const label = document.createElement("label");
        label.className = "suite-case";
        label.innerHTML = `<input type="checkbox" value="${escapeHtml(record.id)}"><span>${escapeHtml(record.testCase.name)}</span>`;
        return label;
      })
    );
    elements.libraryCount.textContent = `${records.length} ${pluralize(records.length, "шаблон", "шаблона", "шаблонов")}`;
    if (!records.length) {
      elements.templates.innerHTML = '<p class="history-empty">Сохранённых шаблонов пока нет.</p>';
      return;
    }
    elements.templates.replaceChildren(
      ...records.map((record) => {
        const item = document.createElement("article");
        item.className = "template-card";
        item.innerHTML = `
          <div class="template-icon">WEB</div>
          <div class="template-info">
            <strong>${escapeHtml(record.testCase.name)}</strong>
            <small>${record.testCase.steps.length} ${pluralize(record.testCase.steps.length, "шаг", "шага", "шагов")} · изменён ${new Date(record.updatedAt).toLocaleDateString("ru-RU")}</small>
          </div>
          <div class="template-actions">
            <button type="button" data-action="edit">Изменить</button>
            <button type="button" data-action="copy">Копировать</button>
            <button class="template-run" type="button" data-action="run">Запустить →</button>
          </div>`;
        item.querySelector('[data-action="edit"]').addEventListener("click", () => editTemplate(record));
        item.querySelector('[data-action="copy"]').addEventListener("click", () => copyTemplate(record.id));
        item.querySelector('[data-action="run"]').addEventListener("click", () => runTemplate(record.id));
        return item;
      })
    );
  } catch {
    elements.templates.innerHTML = '<p class="history-empty">Шаблоны временно недоступны.</p>';
  }
}

async function createSuite(event) {
  event.preventDefault();
  const testCaseIds = [...elements.suiteCaseList.querySelectorAll("input:checked")]
    .map((input) => input.value);
  const response = await fetch("/test-suites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: document.querySelector("#suite-name").value.trim(),
      testCaseIds
    })
  });
  const result = await response.json();
  elements.message.textContent = response.ok
    ? "Набор тестов создан"
    : result.error || "Не удалось создать набор";
  if (response.ok) await loadSuites();
}

async function loadSuites() {
  try {
    const response = await fetch("/test-suites");
    const suites = await response.json();
    if (!response.ok) throw new Error(suites.error);
    if (!suites.length) {
      elements.suiteList.innerHTML = '<p class="history-empty">Наборов пока нет.</p>';
      return;
    }
    elements.suiteList.replaceChildren(...suites.map((suite) => {
      const item = document.createElement("article");
      item.className = "suite-item";
      item.innerHTML = `<div><strong>${escapeHtml(suite.name)}</strong><small>${suite.testCaseIds.length} тест-кейсов</small></div><button class="template-run" type="button">Запустить →</button>`;
      item.querySelector("button").addEventListener("click", () => runSuite(suite.id));
      return item;
    }));
  } catch (error) {
    elements.suiteList.innerHTML = `<p class="history-empty">${escapeHtml(error.message)}</p>`;
  }
}

async function runSuite(id) {
  const response = await fetch(`/test-suites/${id}/runs`, { method: "POST" });
  const result = await response.json();
  if (!response.ok) {
    elements.message.textContent = result.error || "Не удалось запустить набор";
    return;
  }
  elements.message.textContent = `Набор запущен: ${result.runIds.length} тестов`;
  await watchSuiteRun(result.id);
}

async function watchSuiteRun(id) {
  while (true) {
    const response = await fetch(`/test-suite-runs/${id}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    elements.message.textContent = `Набор: ${statusLabel(result.status)} · ${result.runs.length} тестов`;
    if (result.status === "passed" || result.status === "failed") {
      await loadHistory();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function loadNotificationStatus() {
  try {
    const response = await fetch("/notifications");
    const status = await response.json();
    if (!response.ok) throw new Error(status.error);
    const channels = [
      status.webhookConfigured ? "Webhook" : "",
      status.telegramConfigured ? "Telegram" : ""
    ].filter(Boolean);
    elements.notificationStatus.textContent = channels.length
      ? `Уведомления: ${channels.join(" + ")}`
      : "Уведомления не настроены";
  } catch (error) {
    elements.notificationStatus.textContent = error.message || "Статус уведомлений недоступен";
  }
}

async function testNotification() {
  const response = await fetch("/notifications/test", { method: "POST" });
  const result = await response.json();
  elements.message.textContent = response.ok
    ? `Уведомление отправлено: ${result.delivered}/${result.attempted}`
    : result.error || "Каналы уведомлений не настроены";
}

async function importFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  elements.importReport.hidden = false;
  elements.importReport.className = "import-report";
  elements.importReport.textContent = `Импортируем ${file.name}…`;

  try {
    const format = file.name.toLowerCase().endsWith(".csv") ? "csv" : "json";
    const response = await fetch("/test-cases/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format, content: await file.text() })
    });
    const result = await response.json();
    if (!response.ok && !result.importedCount) {
      throw new Error(result.errors?.join("; ") || result.error || "Импорт не выполнен");
    }
    elements.importReport.classList.add(result.errors.length ? "warning" : "success");
    elements.importReport.textContent =
      `Импортировано: ${result.importedCount}.` +
      (result.errors.length ? ` Замечания: ${result.errors.join("; ")}` : "");
    await loadTemplates();
  } catch (error) {
    elements.importReport.classList.add("error");
    elements.importReport.textContent = error.message || "Не удалось импортировать файл";
  } finally {
    event.target.value = "";
  }
}

async function importYouTrack(mode) {
  const report = elements.youTrackReport;
  report.hidden = false;
  report.className = "import-report";
  report.textContent = mode === "demo" ? "Загружаем демонстрационную задачу…" : "Подключаемся к YouTrack…";

  const body = {
    mode,
    baseUrl: document.querySelector("#youtrack-url").value.trim(),
    token: document.querySelector("#youtrack-token").value,
    tokenSecretId: document.querySelector("#youtrack-token-secret").value,
    query: document.querySelector("#youtrack-query").value.trim()
  };

  try {
    const response = await fetch("/connectors/youtrack/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok && !result.importedCount) {
      throw new Error(result.errors?.join("; ") || result.error || "Импорт не выполнен");
    }
    report.classList.add(result.errors.length ? "warning" : "success");
    report.textContent =
      `Прочитано задач: ${result.issuesRead}. Импортировано: ${result.importedCount}.` +
      (result.errors.length ? ` Замечания: ${result.errors.join("; ")}` : "");
    document.querySelector("#youtrack-token").value = "";
    await loadTemplates();
  } catch (error) {
    report.classList.add("error");
    report.textContent = error.message || "YouTrack недоступен";
  }
}

async function importConnector(system, mode, values) {
  const report = elements[`${system}Report`];
  report.hidden = false;
  report.className = "import-report";
  report.textContent = mode === "demo" ? "Загружаем демонстрационную задачу…" : "Подключаемся к сервису…";
  try {
    const response = await fetch(`/connectors/${system}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, ...values })
    });
    const result = await response.json();
    if (!response.ok && !result.importedCount) {
      throw new Error(result.errors?.join("; ") || result.error || "Импорт не выполнен");
    }
    report.classList.add(result.errors.length ? "warning" : "success");
    report.textContent =
      `Прочитано: ${result.issuesRead}. Импортировано: ${result.importedCount}.` +
      (result.errors.length ? ` Замечания: ${result.errors.join("; ")}` : "");
    document.querySelector(`#${system}-token`).value = "";
    await loadTemplates();
  } catch (error) {
    report.classList.add("error");
    report.textContent = error.message || "Сервис недоступен";
  }
}

async function fetchTestData(system, mode, values = {}) {
  const report = document.querySelector("#data-report");
  report.hidden = false;
  report.className = "import-report";
  report.textContent = mode === "demo" ? "Загружаем демонстрационные данные…" : "Получаем данные…";
  try {
    const response = await fetch(`/data/${system}/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, ...values })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось получить данные");
    renderDataRecords(system, result.records);
    report.classList.add("success");
    report.textContent = `Получено записей: ${result.records.length}. Выберите запись для подстановки.`;
    for (const selector of [`#data-${system}-password`, `#data-${system}-token`]) {
      const field = document.querySelector(selector);
      if (field) field.value = "";
    }
  } catch (error) {
    report.classList.add("error");
    report.textContent = error.message || "Источник данных недоступен";
  }
}

function renderDataRecords(system, records) {
  const container = document.querySelector(`#data-${system}-results`);
  container.replaceChildren(
    ...records.map((record) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "data-record";
      button.innerHTML = `<span><strong>${escapeHtml(record.label)}</strong><small>${Object.keys(record.values).length} полей</small></span><span>Использовать →</span>`;
      button.addEventListener("click", () => {
        let current = {};
        try {
          current = JSON.parse(elements.variables.value || "{}");
        } catch {}
        elements.variables.value = JSON.stringify(
          { ...current, ...record.values },
          null,
          2
        );
        document.querySelector("#data-report").textContent =
          `Данные «${record.label}» добавлены в переменные теста`;
        document.querySelector(".editor-panel").scrollIntoView({
          behavior: "smooth"
        });
      });
      return button;
    })
  );
}

async function cancelActiveRun() {
  if (!activeRunId) return;
  elements.cancelRun.disabled = true;
  try {
    await fetch(`/runs/${activeRunId}/cancel`, { method: "POST" });
  } finally {
    elements.cancelRun.disabled = false;
  }
}

async function loadQueue() {
  try {
    const queue = await (await fetch("/queue")).json();
    elements.queueState.textContent =
      `Активно: ${queue.active} · в очереди: ${queue.queued} · лимит: ${queue.limit}`;
  } catch {
    elements.queueState.textContent = "Очередь недоступна";
  }
}

async function loadSchedules() {
  try {
    const schedules = await (await fetch("/schedules")).json();
    if (!schedules.length) {
      elements.scheduleList.innerHTML = '<p class="history-empty">Расписаний пока нет.</p>';
      return;
    }
    elements.scheduleList.replaceChildren(
      ...schedules.map((schedule) => {
        const item = document.createElement("article");
        item.className = "schedule-item";
        const repeat = schedule.repeatMinutes
          ? `каждые ${schedule.repeatMinutes} мин.`
          : "один раз";
        item.innerHTML = `
          <div><strong>${escapeHtml(schedule.name)}</strong><small>Следующий запуск: ${new Date(schedule.nextRunAt).toLocaleString("ru-RU")}</small></div>
          <span>${schedule.enabled ? repeat : "отключено"}</span>
          ${schedule.enabled ? '<button type="button">Отменить</button>' : ""}`;
        item.querySelector("button")?.addEventListener("click", async () => {
          await fetch(`/schedules/${schedule.id}/cancel`, { method: "POST" });
          await loadSchedules();
        });
        return item;
      })
    );
  } catch {
    elements.scheduleList.innerHTML = '<p class="history-empty">Расписания временно недоступны.</p>';
  }
}

async function createSchedule(event) {
  event.preventDefault();
  const repeatValue = document.querySelector("#schedule-repeat").value;
  const body = {
    name: document.querySelector("#schedule-name").value.trim(),
    testCaseId: elements.scheduleTemplate.value,
    runAt: new Date(document.querySelector("#schedule-run-at").value).toISOString(),
    repeatMinutes: repeatValue ? Number(repeatValue) : undefined
  };
  const response = await fetch("/schedules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) {
    elements.message.textContent = result.error || "Не удалось создать расписание";
    return;
  }
  elements.message.textContent = "Расписание создано";
  await loadSchedules();
}

async function loadDevices() {
  try {
    const devices = await (await fetch("/devices")).json();
    if (!devices.length) {
      elements.deviceList.innerHTML = '<p class="history-empty">Устройств пока нет.</p>';
      return;
    }
    elements.deviceList.replaceChildren(
      ...devices.map((device) => {
        const item = document.createElement("article");
        item.className = "schedule-item";
        item.innerHTML = `
          <div><strong>${escapeHtml(device.name)}</strong><small>${escapeHtml(device.appiumEndpoint)}</small></div>
          <span>${device.platform.toUpperCase()} · ${device.enabled ? "доступно" : "отключено"}</span>
          ${device.enabled ? '<button type="button">Отключить</button>' : ""}`;
        item.querySelector("button")?.addEventListener("click", async () => {
          await fetch(`/devices/${device.id}/disable`, { method: "POST" });
          await loadDevices();
        });
        return item;
      })
    );
  } catch {
    elements.deviceList.innerHTML = '<p class="history-empty">Реестр устройств недоступен.</p>';
  }
}

async function createDevice(event) {
  event.preventDefault();
  let capabilities;
  try {
    capabilities = JSON.parse(document.querySelector("#device-capabilities").value);
  } catch {
    elements.message.textContent = "Capabilities должны быть корректным JSON";
    return;
  }
  const response = await fetch("/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: document.querySelector("#device-name").value.trim(),
      platform: document.querySelector("#device-platform").value,
      appiumEndpoint: document.querySelector("#device-endpoint").value.trim(),
      capabilities
    })
  });
  const result = await response.json();
  elements.message.textContent = response.ok
    ? "Устройство добавлено"
    : result.error || "Не удалось добавить устройство";
  if (response.ok) await loadDevices();
}

async function loadSecrets() {
  try {
    const response = await fetch("/secrets");
    const secrets = await response.json();
    if (!response.ok) throw new Error(secrets.error);
    elements.secretList.replaceChildren(
      ...secrets.map((secret) => {
        const item = document.createElement("div");
        item.className = "secret-item";
        item.innerHTML = `<span>${escapeHtml(secret.name)}</span><button type="button">Удалить</button>`;
        item.querySelector("button").addEventListener("click", async () => {
          await fetch(`/secrets/${secret.id}/remove`, { method: "POST" });
          await loadSecrets();
        });
        return item;
      })
    );
    document.querySelectorAll("[data-secret-select]").forEach((select) => {
      const selected = select.value;
      const firstLabel = select.options[0]?.textContent || "Не использовать";
      select.replaceChildren(
        new Option(firstLabel, ""),
        ...secrets.map((secret) => new Option(secret.name, secret.id))
      );
      select.value = selected;
    });
  } catch (error) {
    elements.secretList.innerHTML = `<p class="history-empty">${escapeHtml(error.message || "Vault недоступен")}</p>`;
  }
}

async function createSecret(event) {
  event.preventDefault();
  const response = await fetch("/secrets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: document.querySelector("#secret-name").value.trim(),
      value: document.querySelector("#secret-value").value
    })
  });
  const result = await response.json();
  elements.message.textContent = response.ok
    ? "Секрет зашифрован и сохранён"
    : result.error || "Не удалось сохранить секрет";
  document.querySelector("#secret-value").value = "";
  if (response.ok) await loadSecrets();
}

async function loadAudit() {
  try {
    const parameters = new URLSearchParams({ limit: "30" });
    if (elements.auditMethod.value) {
      parameters.set("method", elements.auditMethod.value);
    }
    if (elements.auditStatus.value) {
      parameters.set("status", elements.auditStatus.value);
    }
    const response = await fetch(`/audit?${parameters}`);
    const events = await response.json();
    if (!response.ok) throw new Error(events.error);
    elements.auditList.replaceChildren(
      ...events.map((event) => {
        const item = document.createElement("div");
        item.className = "audit-item";
        item.innerHTML = `<span><strong>${event.statusCode}</strong> ${escapeHtml(event.method)} ${escapeHtml(event.path)}</span><span>${escapeHtml(event.principalName || "anonymous")}<br>${new Date(event.timestamp).toLocaleString("ru-RU")}</span>`;
        return item;
      })
    );
  } catch (error) {
    elements.auditList.innerHTML = `<p class="history-empty">${escapeHtml(error.message || "Аудит недоступен")}</p>`;
  }
}

function buildTestCase() {
  const rows = [...elements.steps.querySelectorAll(".step-row")];
  if (rows.length === 0) throw new Error("Добавьте хотя бы один шаг");

  let variables;
  try {
    variables = JSON.parse(elements.variables.value || "{}");
  } catch {
    throw new Error("Переменные должны быть корректным JSON-объектом");
  }
  if (!variables || Array.isArray(variables) || typeof variables !== "object") {
    throw new Error("Переменные должны быть JSON-объектом");
  }

  return {
    id: `WEB-${Date.now()}`,
    name: elements.name.value.trim(),
    platform: "web",
    baseUrl: elements.baseUrl.value.trim(),
    variables,
    steps: rows.map((row, index) => {
      const step = {
        id: String(index + 1),
        action: row.querySelector(".step-action").value
      };
      const target = row.querySelector(".step-target").value.trim();
      const value = row.querySelector(".step-value").value;
      if (target) step.target = target;
      if (value) step.value = value;
      return step;
    }),
    source: { system: "manual" }
  };
}

async function submitRun(event) {
  event.preventDefault();
  setFormState(true, "Ставим тест в очередь…");
  setBadge("queued", "В очереди");

  try {
    const response = await fetch("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildTestCase())
    });
    const created = await response.json();
    if (!response.ok) {
      throw new Error(created.details?.join(", ") || created.error || "Не удалось запустить тест");
    }
    await watchRun(created.id);
  } catch (error) {
    setBadge("failed", "Ошибка");
    setFormState(false, error.message);
  }
}

async function watchRun(id) {
  activeRunId = id;
  elements.cancelRun.hidden = false;
  for (;;) {
    const response = await fetch(`/runs/${id}`);
    const record = await response.json();
    if (!response.ok) throw new Error(record.error || "Не удалось получить статус");

    if (record.status === "queued") setBadge("queued", "В очереди");
    if (record.status === "running") setBadge("running", "Выполняется");
    if (record.status === "completed") {
      activeRunId = null;
      elements.cancelRun.hidden = true;
      renderResult(record);
      setFormState(false, record.result?.status === "passed" ? "Проверка завершена успешно" : "Проверка завершена с ошибкой");
      await loadHistory();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function renderResult(record) {
  elements.empty.hidden = true;
  elements.result.hidden = false;

  if (record.error || !record.result) {
    setBadge("failed", "Ошибка запуска");
    elements.resultStatus.textContent = "Ошибка";
    elements.resultProgress.textContent = "0";
    elements.resultDuration.textContent = "—";
    elements.resultSteps.innerHTML = `<li class="failed"><span>!</span><div><strong>Сервис не выполнил тест</strong><small>${escapeHtml(record.error || "Неизвестная ошибка")}</small></div></li>`;
    return;
  }

  const result = record.result;
  const passed = result.steps.filter((step) => step.status === "passed").length;
  const duration = new Date(result.finishedAt) - new Date(result.startedAt);
  const success = result.status === "passed";
  setBadge(success ? "passed" : "failed", success ? "Пройден" : "Не пройден");
  elements.resultStatus.textContent = success ? "Успешно" : "Ошибка";
  elements.resultProgress.textContent = `${passed}/${result.steps.length}`;
  elements.resultDuration.textContent = formatDuration(duration);
  elements.resultSteps.replaceChildren(
    ...result.steps.map((step, index) => {
      const item = document.createElement("li");
      item.className = step.status;
      const sourceStep = record.testCase.steps[index];
      item.innerHTML = `
        <span>${step.status === "passed" ? "✓" : step.status === "failed" ? "×" : "–"}</span>
        <div>
          <strong>${escapeHtml(actions[sourceStep?.action] || sourceStep?.action || `Шаг ${index + 1}`)}</strong>
          <small>${escapeHtml(step.error || sourceStep?.target || "Выполнено")}</small>
        </div>`;
      return item;
    })
  );
}

async function loadHistory() {
  try {
    const response = await fetch("/runs");
    const runs = await response.json();
    if (!runs.length) {
      elements.history.innerHTML = '<p class="history-empty">Запусков пока нет.</p>';
      return;
    }
    elements.history.replaceChildren(
      ...runs.slice(0, 8).map((run) => {
        const item = document.createElement("button");
        const status = run.result?.status || run.status;
        item.className = "history-item";
        item.type = "button";
        item.innerHTML = `
          <span class="history-state ${status}"></span>
          <span><strong>${escapeHtml(run.testCase.name)}</strong><small>${new Date(run.createdAt).toLocaleString("ru-RU")}</small></span>
          <span class="history-platform">WEB</span>
          <span class="history-status">${statusLabel(status)}</span>`;
        item.addEventListener("click", () => renderResult(run));
        return item;
      })
    );
  } catch {
    elements.history.innerHTML = '<p class="history-empty">История временно недоступна.</p>';
  }
}

async function checkHealth() {
  try {
    const response = await fetch("/health");
    if (!response.ok) throw new Error();
    const health = await response.json();
    elements.serviceDot.classList.add("online");
    elements.serviceLabel.textContent =
      health.authRequired && !sessionStorage.getItem("qa-bot-api-key")
        ? "Нужен ключ доступа"
        : "Сервис работает";
  } catch {
    elements.serviceDot.classList.remove("online");
    elements.serviceLabel.textContent = "Сервис недоступен";
  }
}

function configureAccessKey() {
  const current = sessionStorage.getItem("qa-bot-api-key") || "";
  const value = window.prompt(
    "Введите API-ключ. Он будет храниться только в текущей вкладке браузера.",
    current
  );
  if (value === null) return;
  if (value.trim()) {
    sessionStorage.setItem("qa-bot-api-key", value.trim());
  } else {
    sessionStorage.removeItem("qa-bot-api-key");
  }
  checkHealth();
  loadTemplates();
  loadHistory();
  loadSecrets();
  loadAudit();
}

function setFormState(running, message) {
  elements.runButton.disabled = running;
  elements.runButton.querySelector("span").textContent = running ? "Выполняется…" : "Запустить тест";
  elements.message.textContent = message;
}

function setBadge(kind, text) {
  elements.badge.className = `run-badge ${kind}`;
  elements.badge.textContent = text;
}

function statusLabel(status) {
  return {
    passed: "Пройден",
    failed: "Ошибка",
    queued: "В очереди",
    running: "Выполняется",
    completed: "Завершён"
  }[status] || status;
}

function formatDuration(milliseconds) {
  return milliseconds < 1000
    ? `${milliseconds} мс`
    : `${(milliseconds / 1000).toFixed(1).replace(".", ",")} с`;
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value);
  return element.innerHTML;
}

document.querySelector("#add-step").addEventListener("click", () => addStep());
document.querySelector("#access-key").addEventListener("click", configureAccessKey);
document.querySelector("#load-example").addEventListener("click", loadExample);
document.querySelector("#refresh-history").addEventListener("click", loadHistory);
elements.saveCase.addEventListener("click", saveTemplate);
elements.cancelRun.addEventListener("click", cancelActiveRun);
elements.importFile.addEventListener("change", importFile);
document.querySelector("#youtrack-demo").addEventListener("click", () => importYouTrack("demo"));
elements.youTrackForm.addEventListener("submit", (event) => {
  event.preventDefault();
  importYouTrack("live");
});
document.querySelector("#jira-demo").addEventListener("click", () =>
  importConnector("jira", "demo", {})
);
elements.jiraForm.addEventListener("submit", (event) => {
  event.preventDefault();
  importConnector("jira", "live", {
    baseUrl: document.querySelector("#jira-url").value.trim(),
    email: document.querySelector("#jira-email").value.trim(),
    token: document.querySelector("#jira-token").value,
    tokenSecretId: document.querySelector("#jira-token-secret").value,
    query: document.querySelector("#jira-query").value.trim()
  });
});
document.querySelector("#kaiten-demo").addEventListener("click", () =>
  importConnector("kaiten", "demo", {})
);
elements.kaitenForm.addEventListener("submit", (event) => {
  event.preventDefault();
  importConnector("kaiten", "live", {
    baseUrl: document.querySelector("#kaiten-url").value.trim(),
    token: document.querySelector("#kaiten-token").value,
    tokenSecretId: document.querySelector("#kaiten-token-secret").value,
    query: document.querySelector("#kaiten-query").value.trim()
  });
});
document.querySelectorAll("[data-demo]").forEach((button) => {
  button.addEventListener("click", () =>
    fetchTestData(button.dataset.demo, "demo")
  );
});
document.querySelector("#data-1c-form").addEventListener("submit", (event) => {
  event.preventDefault();
  fetchTestData("1c", "live", {
    baseUrl: document.querySelector("#data-1c-url").value.trim(),
    username: document.querySelector("#data-1c-user").value,
    password: document.querySelector("#data-1c-password").value,
    passwordSecretId: document.querySelector("#data-1c-password-secret").value,
    entity: document.querySelector("#data-1c-entity").value.trim(),
    filter: document.querySelector("#data-1c-filter").value.trim()
  });
});
document.querySelector("#data-bitrix24-form").addEventListener("submit", (event) => {
  event.preventDefault();
  fetchTestData("bitrix24", "live", {
    webhookUrl: document.querySelector("#data-bitrix24-webhook").value.trim(),
    webhookUrlSecretId: document.querySelector("#data-bitrix24-webhook-secret").value,
    entityTypeId: Number(document.querySelector("#data-bitrix24-type").value)
  });
});
document.querySelector("#data-amocrm-form").addEventListener("submit", (event) => {
  event.preventDefault();
  fetchTestData("amocrm", "live", {
    baseUrl: document.querySelector("#data-amocrm-url").value.trim(),
    accessToken: document.querySelector("#data-amocrm-token").value,
    accessTokenSecretId: document.querySelector("#data-amocrm-token-secret").value,
    query: document.querySelector("#data-amocrm-query").value.trim()
  });
});
document.querySelector("#schedule-form").addEventListener("submit", createSchedule);
document.querySelector("#device-form").addEventListener("submit", createDevice);
document.querySelector("#secret-form").addEventListener("submit", createSecret);
document.querySelector("#suite-form").addEventListener("submit", createSuite);
document.querySelector("#notification-test").addEventListener("click", testNotification);
document.querySelector("#audit-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  loadAudit();
});
elements.form.addEventListener("submit", submitRun);

loadExample();
checkHealth();
loadHistory();
loadTemplates();
loadSchedules();
loadQueue();
loadDevices();
loadSecrets();
loadAudit();
loadSuites();
loadNotificationStatus();
setInterval(loadQueue, 2_000);
