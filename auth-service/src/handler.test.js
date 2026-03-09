/**
 * handler.test.js
 * 
 * Patrón usado: Dependency Injection.
 * En vez de mockear el módulo completo de AWS (que tiene problemas
 * de hoisting con Jest), le pasamos al handler un cliente falso
 * usando exports.setDbClient().
 */

const { handler, setDbClient } = require("./handler");

// Cliente DynamoDB falso — controlamos qué devuelve send() en cada test
const mockSend = jest.fn();
const fakeClient = { send: mockSend };

// Mocks simples para bcrypt y jwt
jest.mock("bcryptjs", () => ({
  hash: jest.fn().mockResolvedValue("hashed_password"),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock("jsonwebtoken", () => ({
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
}));

describe("Auth Service", () => {

  beforeAll(() => {
    // Inyectamos el cliente falso UNA vez antes de todos los tests
    setDbClient(fakeClient);
  });

  beforeEach(() => {
    // Limpiamos las respuestas previas antes de cada test
    mockSend.mockReset();
  });

  // ── POST /auth/register ──────────────────────────────────────────

  describe("POST /auth/register", () => {

    it("debería retornar 400 si faltan campos", async () => {
      const event = {
        path: "/auth/register",
        httpMethod: "POST",
        body: JSON.stringify({ email: "test@test.com" }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it("debería retornar 201 con token en registro exitoso", async () => {
      mockSend.mockResolvedValueOnce({ Item: null }); // usuario no existe
      mockSend.mockResolvedValueOnce({});             // put exitoso

      const event = {
        path: "/auth/register",
        httpMethod: "POST",
        body: JSON.stringify({ email: "nuevo@test.com", password: "pass123", name: "Juan" }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(JSON.parse(result.body).token).toBe("mock_token");
    });

    it("debería retornar 409 si el usuario ya existe", async () => {
      mockSend.mockResolvedValueOnce({ Item: { email: "ya@existe.com" } });

      const event = {
        path: "/auth/register",
        httpMethod: "POST",
        body: JSON.stringify({ email: "ya@existe.com", password: "pass123", name: "Existente" }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(409);
    });

  });

  // ── POST /auth/login ─────────────────────────────────────────────

  describe("POST /auth/login", () => {

    it("debería retornar 400 si faltan credenciales", async () => {
      const event = {
        path: "/auth/login",
        httpMethod: "POST",
        body: JSON.stringify({ email: "test@test.com" }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it("debería retornar 401 si el usuario no existe", async () => {
      mockSend.mockResolvedValueOnce({ Item: null });

      const event = {
        path: "/auth/login",
        httpMethod: "POST",
        body: JSON.stringify({ email: "no@existe.com", password: "pass" }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    it("debería retornar 200 con token en login exitoso", async () => {
      mockSend.mockResolvedValueOnce({
        Item: { userId: "123", email: "test@test.com", name: "Test", password: "hashed" },
      });

      const event = {
        path: "/auth/login",
        httpMethod: "POST",
        body: JSON.stringify({ email: "test@test.com", password: "pass123" }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).token).toBeDefined();
    });

  });

  // ── Rutas no encontradas ─────────────────────────────────────────

  describe("Rutas no encontradas", () => {

    it("debería retornar 404 para rutas desconocidas", async () => {
      const event = { path: "/auth/unknown", httpMethod: "GET" };
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

  });

});