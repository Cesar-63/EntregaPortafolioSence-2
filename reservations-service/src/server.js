const http = require("http");
const { handler } = require("./handler");

const server = http.createServer(async (req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk.toString()));
  req.on("end", async () => {
    const rawPath = req.url.split("?")[0];
    const parts = rawPath.split("/").filter(Boolean);
    const pathParameters = parts.length >= 2 ? { id: parts[parts.length - 1] } : null;

    const event = {
      httpMethod: req.method,
      path: rawPath,
      rawPath,
      headers: req.headers,
      body: body || null,
      pathParameters,
    };

    console.log(`→ ${req.method} ${req.url}`);

    try {
      const result = await handler(event);
      res.writeHead(result.statusCode, result.headers || { "Content-Type": "application/json" });
      res.end(result.body);
      console.log(`← ${result.statusCode}`);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Error interno" }));
    }
  });
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`\n📅 Reservations Service corriendo en http://localhost:${PORT}`);
  console.log(`\nEndpoints disponibles:`);
  console.log(`  POST   http://localhost:${PORT}/reservations`);
  console.log(`  GET    http://localhost:${PORT}/reservations`);
  console.log(`  GET    http://localhost:${PORT}/reservations/:id`);
  console.log(`  DELETE http://localhost:${PORT}/reservations/:id\n`);
});