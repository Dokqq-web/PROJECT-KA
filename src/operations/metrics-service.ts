export interface QueueMetrics {
  active: number;
  queued: number;
  limit: number;
}

interface RequestMetric {
  count: number;
  durationSeconds: number;
}

export class MetricsService {
  private readonly requests = new Map<string, RequestMetric>();

  observe(method: string, route: string, statusCode: number, durationMs: number): void {
    const key = JSON.stringify([method, route, statusCode]);
    const current = this.requests.get(key) ?? { count: 0, durationSeconds: 0 };
    current.count += 1;
    current.durationSeconds += durationMs / 1_000;
    this.requests.set(key, current);
  }

  render(queue: QueueMetrics, uptimeSeconds = process.uptime()): string {
    const lines = [
      "# HELP qa_bot_http_requests_total Total number of HTTP requests.",
      "# TYPE qa_bot_http_requests_total counter"
    ];
    for (const [key, metric] of this.requests) {
      const [method, route, status] = JSON.parse(key) as [string, string, number];
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"`;
      lines.push(`qa_bot_http_requests_total{${labels}} ${metric.count}`);
      lines.push(`qa_bot_http_request_duration_seconds_sum{${labels}} ${metric.durationSeconds.toFixed(6)}`);
      lines.push(`qa_bot_http_request_duration_seconds_count{${labels}} ${metric.count}`);
    }
    lines.push(
      "# HELP qa_bot_queue_active Currently running tests.",
      "# TYPE qa_bot_queue_active gauge",
      `qa_bot_queue_active ${queue.active}`,
      "# HELP qa_bot_queue_queued Tests waiting in the queue.",
      "# TYPE qa_bot_queue_queued gauge",
      `qa_bot_queue_queued ${queue.queued}`,
      "# HELP qa_bot_queue_limit Configured parallel run limit.",
      "# TYPE qa_bot_queue_limit gauge",
      `qa_bot_queue_limit ${queue.limit}`,
      "# HELP qa_bot_process_uptime_seconds Process uptime.",
      "# TYPE qa_bot_process_uptime_seconds gauge",
      `qa_bot_process_uptime_seconds ${uptimeSeconds.toFixed(3)}`,
      ""
    );
    return lines.join("\n");
  }
}

export function normalizeRoute(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
    .replace(/\/runs\/[^/]+$/i, "/runs/:id")
    .replace(/\/test-cases\/[^/]+$/i, "/test-cases/:id");
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
