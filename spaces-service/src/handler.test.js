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
  DeleteItemCommand: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const AUTH_HEADER = { authorization: "Bearer mock_token" };

describe("Spaces Service", () => {

  beforeAll(() => {
    setDbClient(fakeClient);
  });

  beforeEach(() => {
    mockSend.mockReset();
    // mockReset limpia TODO — implementación, cola de retornos y llamadas
    // Por eso hay que redefinir el comportamiento por defecto acá
    jwt.verify.mockReset();
    jwt.verify.mockReturnValue({ userId: "user-1", email: "test@test.com" });
  });

  // ── GET /spaces ──────────────────────────────────────────────────

  describe("GET /spaces", () => {

    it("debería retornar lista vacía si no hay espacios", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = { path: "/spaces", httpMethod: "GET", headers: {} };
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).spaces).toEqual([]);
    });

    it("debería retornar los espacios existentes", async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { spaceId: "1", name: "Sala A", capacity: 10 },
          { spaceId: "2", name: "Sala B", capacity: 5 },
        ],
      });

      const event = { path: "/spaces", httpMethod: "GET", headers: {} };
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).spaces).toHaveLength(2);
    });

  });

  // ── GET /spaces/:id ──────────────────────────────────────────────

  describe("GET /spaces/:id", () => {

    it("debería retornar 404 si el espacio no existe", async () => {
      mockSend.mockResolvedValueOnce({ Item: null });

      const event = { path: "/spaces/id-inexistente", httpMethod: "GET", headers: {} };
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
    });

    it("debería retornar el espacio si existe", async () => {
      mockSend.mockResolvedValueOnce({
        Item: { spaceId: "abc-123", name: "Sala A", capacity: 10 },
      });

      const event = { path: "/spaces/abc-123", httpMethod: "GET", headers: {} };
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).space).toBeDefined();
    });

  });

  // ── POST /spaces ─────────────────────────────────────────────────

  describe("POST /spaces", () => {

    it("debería retornar 400 si faltan campos requeridos", async () => {
      const event = {
        path: "/spaces",
        httpMethod: "POST",
        headers: AUTH_HEADER,
        body: JSON.stringify({ description: "Sin nombre ni capacidad" }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it("debería crear un espacio correctamente", async () => {
      mockSend.mockResolvedValueOnce({});

      const event = {
        path: "/spaces",
        httpMethod: "POST",
        headers: AUTH_HEADER,
        body: JSON.stringify({ name: "Sala A", capacity: 10, location: "Piso 2" }),
      };
      const result = await handler(event);

      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body.space.name).toBe("Sala A");
      expect(body.space.available).toBe(true);
    });

    it("debería retornar 401 si no hay token", async () => {
      // Para este test puntual, verify lanza error
      jwt.verify.mockImplementationOnce(() => {
        const err = new Error("jwt must be provided");
        err.name = "JsonWebTokenError";
        throw err;
      });

      const event = {
        path: "/spaces",
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ name: "Sala X", capacity: 5 }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

  });

  // ── DELETE /spaces/:id ───────────────────────────────────────────

  describe("DELETE /spaces/:id", () => {

    it("debería eliminar un espacio correctamente", async () => {
      mockSend.mockResolvedValueOnce({});

      const event = {
        path: "/spaces/space-1",
        httpMethod: "DELETE",
        headers: AUTH_HEADER,
      };
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toContain("eliminado");
    });

  });

  // ── Rutas no encontradas ─────────────────────────────────────────

  describe("Rutas no encontradas", () => {

    it("debería retornar 404 para rutas desconocidas", async () => {
      const event = { path: "/spaces/a/b/c", httpMethod: "PATCH", headers: {} };
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

  });

});