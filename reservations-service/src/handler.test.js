const { handler, setDbClient } = require("./handler");

const mockSend = jest.fn();
const fakeClient = { send: mockSend };

jest.mock("jsonwebtoken", () => ({
  verify: jest.fn(),
  sign: jest.fn().mockReturnValue("mock_token"),
}));

jest.mock("@aws-sdk/util-dynamodb", () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj),
}));

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn(),
  PutItemCommand: jest.fn(),
  GetItemCommand: jest.fn(),
  ScanCommand: jest.fn(),
  UpdateItemCommand: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const AUTH_HEADER = { authorization: "Bearer mock_token" };
const MOCK_USER   = { userId: "user-1", email: "test@test.com" };

describe("Reservations Service", () => {

  beforeAll(() => {
    setDbClient(fakeClient);
  });

  beforeEach(() => {
    mockSend.mockReset();
    jwt.verify.mockReset();
    jwt.verify.mockReturnValue(MOCK_USER);
  });

  // ── POST /reservations ───────────────────────────────────────────

  describe("POST /reservations", () => {

    it("debería retornar 400 si faltan campos", async () => {
      const event = {
        path: "/reservations",
        httpMethod: "POST",
        headers: AUTH_HEADER,
        body: JSON.stringify({ spaceId: "space-1" }), // faltan startTime y endTime
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it("debería retornar 400 si startTime >= endTime", async () => {
      const event = {
        path: "/reservations",
        httpMethod: "POST",
        headers: AUTH_HEADER,
        body: JSON.stringify({
          spaceId: "space-1",
          startTime: "2025-04-01T12:00:00Z",
          endTime:   "2025-04-01T10:00:00Z", // endTime ANTES que startTime
        }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain("anterior");
    });

    it("debería retornar 404 si el espacio no existe", async () => {
      mockSend.mockResolvedValueOnce({ Item: null }); // GetItem espacio → no existe

      const event = {
        path: "/reservations",
        httpMethod: "POST",
        headers: AUTH_HEADER,
        body: JSON.stringify({
          spaceId:   "espacio-fantasma",
          startTime: "2025-04-01T10:00:00Z",
          endTime:   "2025-04-01T12:00:00Z",
        }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

    it("debería retornar 409 si hay conflicto de horario", async () => {
      mockSend.mockResolvedValueOnce({ Item: { spaceId: "space-1" } }); // espacio existe
      mockSend.mockResolvedValueOnce({ Items: [{ reservationId: "res-existente" }] }); // conflicto

      const event = {
        path: "/reservations",
        httpMethod: "POST",
        headers: AUTH_HEADER,
        body: JSON.stringify({
          spaceId:   "space-1",
          startTime: "2025-04-01T10:00:00Z",
          endTime:   "2025-04-01T12:00:00Z",
        }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).error).toContain("horario");
    });

    it("debería crear la reserva correctamente", async () => {
      mockSend.mockResolvedValueOnce({ Item: { spaceId: "space-1" } }); // espacio existe
      mockSend.mockResolvedValueOnce({ Items: [] });                     // sin conflictos
      mockSend.mockResolvedValueOnce({});                                // put ok

      const event = {
        path: "/reservations",
        httpMethod: "POST",
        headers: AUTH_HEADER,
        body: JSON.stringify({
          spaceId:   "space-1",
          startTime: "2025-04-01T10:00:00Z",
          endTime:   "2025-04-01T12:00:00Z",
          notes:     "Reunión de equipo",
        }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body.reservation.status).toBe("active");
      expect(body.reservation.userId).toBe("user-1");
    });

  });

  // ── GET /reservations ────────────────────────────────────────────

  describe("GET /reservations", () => {

    it("debería listar las reservas del usuario autenticado", async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { reservationId: "r1", spaceId: "s1", userId: "user-1", status: "active" },
        ],
      });

      const event = { path: "/reservations", httpMethod: "GET", headers: AUTH_HEADER };
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).reservations).toHaveLength(1);
    });

  });

  // ── GET /reservations/:id ────────────────────────────────────────

  describe("GET /reservations/:id", () => {

    it("debería retornar 404 si la reserva no existe", async () => {
      mockSend.mockResolvedValueOnce({ Item: null });

      const event = {
        path: "/reservations/no-existe",
        httpMethod: "GET",
        headers: AUTH_HEADER,
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

    it("debería retornar la reserva si existe", async () => {
      mockSend.mockResolvedValueOnce({
        Item: { reservationId: "res-1", spaceId: "space-1", userId: "user-1" },
      });

      const event = {
        path: "/reservations/res-1",
        httpMethod: "GET",
        headers: AUTH_HEADER,
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).reservation).toBeDefined();
    });

  });

  // ── DELETE /reservations/:id ─────────────────────────────────────

  describe("DELETE /reservations/:id", () => {

    it("debería retornar 404 si la reserva no existe", async () => {
      mockSend.mockResolvedValueOnce({ Item: null });

      const event = {
        path: "/reservations/no-existe",
        httpMethod: "DELETE",
        headers: AUTH_HEADER,
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

    it("debería retornar 403 si la reserva no pertenece al usuario", async () => {
      // La reserva pertenece a otro usuario
      const { unmarshall } = require("@aws-sdk/util-dynamodb");
      unmarshall.mockReturnValueOnce({
        reservationId: "res-1",
        userId: "otro-usuario",
        status: "active",
      });
      mockSend.mockResolvedValueOnce({ Item: { reservationId: "res-1" } });

      const event = {
        path: "/reservations/res-1",
        httpMethod: "DELETE",
        headers: AUTH_HEADER,
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });

    it("debería retornar 400 si la reserva ya fue cancelada", async () => {
      const { unmarshall } = require("@aws-sdk/util-dynamodb");
      unmarshall.mockReturnValueOnce({
        reservationId: "res-1",
        userId: "user-1",
        status: "cancelled", // ya cancelada
      });
      mockSend.mockResolvedValueOnce({ Item: { reservationId: "res-1" } });

      const event = {
        path: "/reservations/res-1",
        httpMethod: "DELETE",
        headers: AUTH_HEADER,
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it("debería cancelar la reserva correctamente", async () => {
      const { unmarshall } = require("@aws-sdk/util-dynamodb");
      unmarshall.mockReturnValueOnce({
        reservationId: "res-1",
        userId: "user-1",
        status: "active",
      });
      mockSend.mockResolvedValueOnce({ Item: { reservationId: "res-1" } }); // get ok
      mockSend.mockResolvedValueOnce({});                                    // update ok

      const event = {
        path: "/reservations/res-1",
        httpMethod: "DELETE",
        headers: AUTH_HEADER,
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toContain("cancelada");
    });

  });

  // ── Rutas no encontradas ─────────────────────────────────────────

  describe("Rutas no encontradas", () => {

    it("debería retornar 404 para rutas desconocidas", async () => {
      const event = { path: "/reservations/a/b", httpMethod: "PATCH", headers: {} };
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

  });

});