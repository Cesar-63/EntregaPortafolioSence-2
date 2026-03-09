const {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  ScanCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const RESERVATIONS_TABLE = process.env.RESERVATIONS_TABLE || "Reservations";
const SPACES_TABLE       = process.env.SPACES_TABLE       || "Spaces";
const JWT_SECRET         = process.env.JWT_SECRET         || "dev-secret-change-in-prod";

// Cliente inyectable — mismo patrón que los otros servicios
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

const verifyToken = (event) => {
  const auth = event.headers?.Authorization || event.headers?.authorization || "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) {
    const e = new Error("Token no proporcionado");
    e.name = "JsonWebTokenError";
    throw e;
  }
  return jwt.verify(token, JWT_SECRET);
};

const extractId = (path) => {
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : null;
};

// POST /reservations — crear reserva
const createReservation = async (event) => {
  const user = verifyToken(event);
  const { spaceId, startTime, endTime, notes } = JSON.parse(event.body || "{}");

  if (!spaceId || !startTime || !endTime) {
    return response(400, { error: "spaceId, startTime y endTime son requeridos" });
  }

  if (new Date(startTime) >= new Date(endTime)) {
    return response(400, { error: "startTime debe ser anterior a endTime" });
  }

  // 1. Verificar que el espacio existe
  const spaceResult = await dbClient.send(new GetItemCommand({
    TableName: SPACES_TABLE,
    Key: marshall({ spaceId }),
  }));

  if (!spaceResult.Item) {
    return response(404, { error: "Espacio no encontrado" });
  }

  // 2. Verificar conflicto de horarios con reservas activas del mismo espacio
  const conflictsResult = await dbClient.send(new ScanCommand({
    TableName: RESERVATIONS_TABLE,
    FilterExpression:
      "spaceId = :spaceId AND #st = :active AND startTime < :endTime AND endTime > :startTime",
    ExpressionAttributeNames: { "#st": "status" },
    ExpressionAttributeValues: marshall({
      ":spaceId": spaceId,
      ":active":  "active",
      ":startTime": startTime,
      ":endTime":   endTime,
    }),
  }));

  if (conflictsResult.Items && conflictsResult.Items.length > 0) {
    return response(409, { error: "El espacio ya tiene una reserva en ese horario" });
  }

  // 3. Crear la reserva
  const reservationId = uuidv4();
  const reservation = {
    reservationId,
    spaceId,
    userId:     user.userId,
    userEmail:  user.email,
    startTime,
    endTime,
    notes:      notes || "",
    status:     "active",
    createdAt:  new Date().toISOString(),
  };

  await dbClient.send(new PutItemCommand({
    TableName: RESERVATIONS_TABLE,
    Item: marshall(reservation),
  }));

  return response(201, { message: "Reserva creada", reservation });
};

// GET /reservations — listar reservas del usuario autenticado
const listReservations = async (event) => {
  const user = verifyToken(event);

  const result = await dbClient.send(new ScanCommand({
    TableName: RESERVATIONS_TABLE,
    FilterExpression: "userId = :userId",
    ExpressionAttributeValues: marshall({ ":userId": user.userId }),
  }));

  const reservations = (result.Items || []).map(unmarshall);
  return response(200, { reservations });
};

// GET /reservations/:id — obtener una reserva
const getReservation = async (event) => {
  verifyToken(event);
  const reservationId = extractId(event.path || "");
  if (!reservationId) return response(400, { error: "ID requerido" });

  const result = await dbClient.send(new GetItemCommand({
    TableName: RESERVATIONS_TABLE,
    Key: marshall({ reservationId }),
  }));

  if (!result.Item) return response(404, { error: "Reserva no encontrada" });
  return response(200, { reservation: unmarshall(result.Item) });
};

// DELETE /reservations/:id — cancelar reserva
const cancelReservation = async (event) => {
  const user = verifyToken(event);
  const reservationId = extractId(event.path || "");
  if (!reservationId) return response(400, { error: "ID requerido" });

  // Verificar que existe y pertenece al usuario
  const result = await dbClient.send(new GetItemCommand({
    TableName: RESERVATIONS_TABLE,
    Key: marshall({ reservationId }),
  }));

  if (!result.Item) return response(404, { error: "Reserva no encontrada" });

  const reservation = unmarshall(result.Item);

  if (reservation.userId !== user.userId) {
    return response(403, { error: "No autorizado para cancelar esta reserva" });
  }

  if (reservation.status === "cancelled") {
    return response(400, { error: "La reserva ya fue cancelada" });
  }

  await dbClient.send(new UpdateItemCommand({
    TableName: RESERVATIONS_TABLE,
    Key: marshall({ reservationId }),
    UpdateExpression: "SET #st = :cancelled, cancelledAt = :now",
    ExpressionAttributeNames: { "#st": "status" },
    ExpressionAttributeValues: marshall({
      ":cancelled": "cancelled",
      ":now": new Date().toISOString(),
    }),
  }));

  return response(200, { message: "Reserva cancelada", reservationId });
};

// Router
exports.handler = async (event) => {
  console.log("Reservations event:", JSON.stringify(event));
  const path   = event.path || event.rawPath || "";
  const method = event.httpMethod || event.requestContext?.http?.method || "";

  try {
    if (method === "POST"   && path === "/reservations")           return await createReservation(event);
    if (method === "GET"    && path === "/reservations")           return await listReservations(event);
    if (method === "GET"    && path.startsWith("/reservations/"))  return await getReservation(event);
    if (method === "DELETE" && path.startsWith("/reservations/"))  return await cancelReservation(event);
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