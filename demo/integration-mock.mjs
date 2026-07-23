import { createServer } from "node:http";

const port = Number(process.env.INTEGRATION_MOCK_PORT ?? 4399);

createServer(async (request, response) => {
  const authorization = request.headers.authorization ?? "";
  if (!authorization) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "missing authorization" }));
    return;
  }
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path === "/rest/api/3/search/jql") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        issues: [{
          id: "1",
          key: "MOCK-1",
          fields: {
            summary: "Vault-backed Jira import",
            description:
              "```qa\nbaseUrl=http://localhost:4173\nopen | /\nassertVisible | #login-panel\n```"
          }
        }]
      })
    );
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
}).listen(port, () => {
  console.log(`Integration mock: http://localhost:${port}`);
});

