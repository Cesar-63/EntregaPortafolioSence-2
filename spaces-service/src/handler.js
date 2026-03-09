const {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  ScanCommand,
  UpdateItemCommand,
  DeleteItemCommand,
} = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const TABLE_NAME = process.env.SPACES_TABLE || "Spaces";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-prod";

// Cliente inyectable (mismo patrón que auth-service)
let dbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  ...(process.env.DYNAMODB_ENDPOINT && { endpoint: process.env.DYNAMODB_ENDPOINT }),
});

const setDbClient = (client) => { dbClient = client; };

const response = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});

// Verifica el JWT del header Authorization
const verifyToken = (event) => {
  const auth = event.headers?.Authorization || event.headers?.authorization || "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) { const e = new Error("Token no proporcionado"); e.name = "JsonWebTokenError"; throw e; }
  return jwt.verify(token, JWT_SECRET);
};

// Extrae el :id del path  (/spaces/abc-123 → "abc-123")
const extractId = (path) => {
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : null;
};

// GET /spaces — listar todos los espacios (público)
const listSpaces = async () => {
  const result = await dbClient.send(new ScanCommand({ TableName: TABLE_NAME }));
  const spaces = (result.Items || []).map(unmarshall);
  return response(200, { spaces });
};

// GET /spaces/:id — obtener un espacio (público)
const getSpace = async (event) => {
  const spaceId = extractId(event.path || "");
  if (!spaceId) return response(400, { error: "ID requerido" });

  const result = await dbClient.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ spaceId }),
  }));

  if (!result.Item) return response(404, { error: "Espacio no encontrado" });
  return response(200, { space: unmarshall(result.Item) });
};

// POST /spaces — crear espacio (requiere JWT)
const createSpace = async (event) => {
  verifyToken(event);
  const { name, description, capacity, location } = JSON.parse(event.body || "{}");

  if (!name || !capacity) {
    return response(400, { error: "name y capacity son requeridos" });
  }

  const spaceId = uuidv4();
  const space = {
    spaceId,
    name,
    description: description || "",
    capacity: Number(capacity),
    location: location || "",
    available: true,
    createdAt: new Date().toISOString(),
  };

  await dbClient.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(space),
  }));

  return response(201, { message: "Espacio creado", space });
};

// PUT /spaces/:id — actualizar espacio (requiere JWT)
const updateSpace = async (event) => {
  verifyToken(event);
  const spaceId = extractId(event.path || "");
  if (!spaceId) return response(400, { error: "ID requerido" });

  const updates = JSON.parse(event.body || "{}");
  const updateExpressions = [];
  const expressionValues = {};
  const expressionNames = {};

  for (const [key, value] of Object.entries(updates)) {
    if (key === "spaceId") continue;
    updateExpressions.push(`#${key} = :${key}`);
    expressionNames[`#${key}`] = key;
    expressionValues[`:${key}`] = value;
  }

  if (updateExpressions.length === 0) {
    return response(400, { error: "No hay campos para actualizar" });
  }

  await dbClient.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ spaceId }),
    UpdateExpression: `SET ${updateExpressions.join(", ")}`,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: marshall(expressionValues),
  }));

  return response(200, { message: "Espacio actualizado", spaceId });
};

// DELETE /spaces/:id — eliminar espacio (requiere JWT)
const deleteSpace = async (event) => {
  verifyToken(event);
  const spaceId = extractId(event.path || "");
  if (!spaceId) return response(400, { error: "ID requerido" });

  await dbClient.send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ spaceId }),
  }));

  return response(200, { message: "Espacio eliminado", spaceId });
};

// Router
exports.handler = async (event) => {
  console.log("Spaces event:", JSON.stringify(event));
  const path = event.path || event.rawPath || "";
  const method = event.httpMethod || event.requestContext?.http?.method || "";

  try {
    if (method === "GET"    && path === "/spaces")        return await listSpaces(event);
    if (method === "GET"    && path.startsWith("/spaces/")) return await getSpace(event);
    if (method === "POST"   && path === "/spaces")        return await createSpace(event);
    if (method === "PUT"    && path.startsWith("/spaces/")) return await updateSpace(event);
    if (method === "DELETE" && path.startsWith("/spaces/")) return await deleteSpace(event);
    return response(404, { error: "Ruta no encontrada" });
  } catch (err) {
    console.error("Error:", err);
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return response(401, { error: "Token inválido o expirado" });
    }
    return response(500, { error: "Error interno del servidor" });
  }
};

exports.setDbClient = setDbClient;