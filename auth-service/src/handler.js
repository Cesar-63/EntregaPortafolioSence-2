const { DynamoDBClient, PutItemCommand, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const TABLE_NAME = process.env.USERS_TABLE || "Users";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-prod";

// Cliente DynamoDB — puede ser reemplazado en tests con setDbClient()
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

const register = async (event) => {
  const { email, password, name } = JSON.parse(event.body || "{}");

  if (!email || !password || !name) {
    return response(400, { error: "email, password y name son requeridos" });
  }

  const existing = await dbClient.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ email }),
  }));

  if (existing.Item) {
    return response(409, { error: "El usuario ya existe" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const userId = uuidv4();

  await dbClient.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({ email, userId, name, password: hashedPassword, createdAt: new Date().toISOString() }),
  }));

  const token = jwt.sign({ userId, email, name }, JWT_SECRET, { expiresIn: "24h" });
  return response(201, { message: "Usuario registrado", token, userId });
};

const login = async (event) => {
  const { email, password } = JSON.parse(event.body || "{}");

  if (!email || !password) {
    return response(400, { error: "email y password son requeridos" });
  }

  const result = await dbClient.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ email }),
  }));

  if (!result.Item) {
    return response(401, { error: "Credenciales inválidas" });
  }

  const user = unmarshall(result.Item);
  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    return response(401, { error: "Credenciales inválidas" });
  }

  const token = jwt.sign(
    { userId: user.userId, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: "24h" }
  );

  return response(200, { token, userId: user.userId, name: user.name });
};

exports.handler = async (event) => {
  console.log("Auth event:", JSON.stringify(event));
  const path = event.path || event.rawPath || "";
  const method = event.httpMethod || event.requestContext?.http?.method || "";

  try {
    if (method === "POST" && path.endsWith("/register")) return await register(event);
    if (method === "POST" && path.endsWith("/login")) return await login(event);
    return response(404, { error: "Ruta no encontrada" });
  } catch (err) {
    console.error("Error:", err);
    return response(500, { error: "Error interno del servidor" });
  }
};

exports.setDbClient = setDbClient;