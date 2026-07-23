import type { RunRecord } from "./run-service.js";

export class ReportService {
  html(run: RunRecord): string {
    const status = runStatus(run);
    const rows = (run.result?.steps ?? []).map((step) => `
      <tr>
        <td>${escapeHtml(step.stepId)}</td>
        <td>${escapeHtml(step.status)}</td>
        <td>${escapeHtml(duration(step.startedAt, step.finishedAt))}</td>
        <td>${escapeHtml(step.error ?? "")}</td>
      </tr>`).join("");
    return `<!doctype html>
<html lang="ru"><head><meta charset="UTF-8"><title>${escapeHtml(run.testCase.name)}</title>
<style>body{font:14px system-ui;margin:32px;color:#17201b}table{border-collapse:collapse;width:100%}th,td{padding:8px;border:1px solid #dfe5e1;text-align:left}.passed{color:#167447}.failed{color:#b22b2b}</style>
</head><body>
<h1>${escapeHtml(run.testCase.name)}</h1>
<p>Run: <code>${escapeHtml(run.id)}</code></p>
<p class="${status}">Статус: <strong>${status.toUpperCase()}</strong></p>
${run.error ? `<p>Ошибка: ${escapeHtml(run.error)}</p>` : ""}
<table><thead><tr><th>Шаг</th><th>Статус</th><th>Длительность</th><th>Ошибка</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
  }

  junit(run: RunRecord): string {
    const steps = run.result?.steps ?? [];
    const failures = steps.filter((step) => step.status === "failed").length +
      Number(Boolean(run.error));
    let cases = steps.map((step) => {
      const seconds =
        (new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()) /
        1_000;
      const failure = step.status === "failed"
        ? `<failure message="${escapeXml(step.error ?? "Step failed")}">${escapeXml(step.error ?? "")}</failure>`
        : step.status === "skipped"
          ? "<skipped/>"
          : "";
      return `<testcase name="${escapeXml(step.stepId)}" classname="${escapeXml(run.testCase.name)}" time="${seconds.toFixed(3)}">${failure}</testcase>`;
    }).join("");
    if (run.error) {
      cases +=
        `<testcase name="runner" classname="${escapeXml(run.testCase.name)}"><failure message="${escapeXml(run.error)}"/></testcase>`
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="${escapeXml(run.testCase.name)}" tests="${steps.length + Number(Boolean(run.error))}" failures="${failures}" time="${runDuration(run)}">
${cases}
</testsuite>`;
  }
}

function runStatus(run: RunRecord): "passed" | "failed" {
  return run.error || run.result?.status === "failed" ? "failed" : "passed";
}

function runDuration(run: RunRecord): string {
  const start = run.result?.startedAt ?? run.createdAt;
  const end = run.result?.finishedAt ?? run.updatedAt;
  return ((new Date(end).getTime() - new Date(start).getTime()) / 1_000).toFixed(3);
}

function duration(start: string, end: string): string {
  return `${new Date(end).getTime() - new Date(start).getTime()} ms`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function escapeXml(value: string): string {
  return escapeHtml(value).replaceAll("'", "&apos;");
}
