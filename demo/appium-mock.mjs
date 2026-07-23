import { createServer } from "node:http";

const port = Number(process.env.APPIUM_MOCK_PORT ?? 4723);

createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  let value = null;

  if (request.method === "POST" && path === "/session") {
    value = { sessionId: "demo-mobile-session", capabilities: {} };
  } else if (request.method === "POST" && path.endsWith("/element")) {
    value = { "element-6066-11e4-a52e-4f735466cecf": "demo-element" };
  } else if (request.method === "GET" && path.endsWith("/text")) {
    value = "Добро пожаловать";
  } else if (request.method === "GET" && path.endsWith("/screenshot")) {
    value =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDWQAAAABJRU5ErkJggg==";
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ value }));
}).listen(port, () => {
  console.log(`Mock Appium: http://localhost:${port}`);
});

