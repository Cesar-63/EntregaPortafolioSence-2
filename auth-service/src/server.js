/**
 * server.js — Wrapper HTTP para desarrollo local
 *
 * Este archivo NO va a AWS. Solo sirve para probar el handler
 * como si fuera API Gateway, sin necesitar Lambda ni la nube.
 *
 * En AWS, API Gateway se encarga de construir el "event" y
 * llamar a handler(event). Acá lo hacemos a mano.
 */

const http = require("http");
const { handler } = require("./handler");

// Detectar si DynamoDB local está configurado
const DYNAMO_ENDPOINT = process.env.DYNAMODB_ENDPOINT || null;
if (DYNAMO_ENDPOINT) {
  console.log(`📦 Usando DynamoDB local en: ${DYNAMO_ENDPOINT}`);
} else {
  console.log(`☁️  Usando DynamoDB de AWS (requiere credenciales)`);
}

const server = http.createServer(async (req, res) => {
  // Leer el body de la request
  let body = "";
  req.on("data", (chunk) => (body += chunk.toString()));

  req.on("end", async () => {
    // Construir el "event" igual a lo que manda API Gateway a Lambda
    const event = {
      httpMethod: req.method,
      path: req.url.split("?")[0],
      rawPath: req.url.split("?")[0],
      headers: req.headers,
      body: body || null,
      pathParameters: null, // auth no usa path params
    };

    console.log(`→ ${req.method} ${req.url}`);

    try {
      const result = await handler(event);

      // Responder con lo que devolvió el handler
      res.writeHead(result.statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        ...(result.headers || {}),
      });
      res.end(result.body);

      console.log(`← ${result.statusCode}`);
    } catch (err) {
      console.error("Error inesperado:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Error interno del servidor" }));
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🔐 Auth Service corriendo en http://localhost:${PORT}`);
  console.log(`\nEndpoints disponibles:`);
  console.log(`  POST http://localhost:${PORT}/auth/register`);
  console.log(`  POST http://localhost:${PORT}/auth/login`);
  console.log(`\nEjemplo:`);
  console.log(
    `  curl -X POST http://localhost:${PORT}/auth/register \\`
  );
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(
    `    -d '{"email":"test@test.com","password":"pass123","name":"Juan"}'\n`
  );
});
