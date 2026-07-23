import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { JiraConnector } from "../dist/connectors/jira-connector.js";

test("Jira connector follows pagination within an explicit outbound allowlist", async (context) => {
  let requests = 0;
  const server = createServer(async (request, response) => {
    requests += 1;
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const secondPage = input.nextPageToken === "page-2";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      issues: [{
        id: secondPage ? "2" : "1",
        key: secondPage ? "QA-2" : "QA-1",
        fields: {
          summary: secondPage ? "Second" : "First",
          description: "```qa\nbaseUrl=https://app.example.test\nopen | /\n```"
        }
      }],
      nextPageToken: secondPage ? undefined : "page-2",
      isLast: secondPage
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const previous = process.env.OUTBOUND_HOST_ALLOWLIST;
  process.env.OUTBOUND_HOST_ALLOWLIST = "127.0.0.1";
  context.after(() => {
    if (previous === undefined) delete process.env.OUTBOUND_HOST_ALLOWLIST;
    else process.env.OUTBOUND_HOST_ALLOWLIST = previous;
  });

  const result = await new JiraConnector().import({
    mode: "live",
    baseUrl: `http://127.0.0.1:${address.port}`,
    email: "qa@example.test",
    token: "token",
    query: "project = QA"
  });
  assert.equal(requests, 2);
  assert.equal(result.issuesRead, 2);
  assert.deepEqual(result.testCases.map((item) => item.source.externalId), [
    "QA-1",
    "QA-2"
  ]);
});
