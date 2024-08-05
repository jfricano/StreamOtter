import { WebSocketManager, WebSocketConnection } from "../src/WebSocketManager";
import WebSocket, { Server } from "ws";

describe("WebSocketManager", () => {
  let manager: WebSocketManager;
  let server: Server;
  const url = "ws://localhost:8080";

  beforeEach((done) => {
    console.log("Starting server...");
    manager = new WebSocketManager();
    server = new Server({ port: 8080 }, () => {
      console.log("Server started");
      done();
    });
  });

  afterEach((done) => {
    console.log("Closing server...");
    server.clients.forEach((client) => client.terminate()); // Ensure all clients are closed
    server.close(() => {
      console.log("Server closed");
      done();
    });
  });

  test("should create a WebSocket connection", (done) => {
    console.log("Creating WebSocket connection...");
    const connection: WebSocketConnection = manager.createConnection(url);

    connection.socket.on("open", () => {
      console.log("WebSocket connection established");
      try {
        expect(connection.socket.readyState).toBe(WebSocket.OPEN);
        expect(connection.url).toBe(url);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  test("should send and receive messages", (done) => {
    const connection = manager.createConnection(url);

    server.on("connection", (socket) => {
      socket.on("message", (message) => {
        expect(message.toString()).toBe(
          JSON.stringify({ type: "greeting", payload: "Hello, WebSocket!" })
        );
        socket.send(message);
      });
    });

    const message = { type: "greeting", payload: "Hello, WebSocket!" };
    const listener = jest.fn((receivedMessage) => {
      expect(receivedMessage).toEqual(message);
      done();
    });

    connection.socket.on("open", () => {
      manager.onMessage(connection, listener);
      manager.sendMessage(connection, message);
    });

    connection.socket.on("error", (error) => {
      console.error("WebSocket error:", error);
      done(error);
    });
  });

  test("should close WebSocket connection", (done) => {
    const connection = manager.createConnection(url);

    connection.socket.on("open", () => {
      manager.closeConnection(connection, 1000, "Normal Closure");
    });

    connection.socket.on("close", () => {
      expect(connection.socket.readyState).toBe(WebSocket.CLOSED);
      done();
    });

    connection.socket.on("error", (error) => {
      console.error("WebSocket error:", error);
      done(error);
    });
  });

  test("should handle connection closed event", (done) => {
    const connection = manager.createConnection(url);
    const listener = jest.fn((code, reason) => {
      expect(code).toBe(1000);
      expect(reason).toBe("Normal Closure");
      done();
    });

    connection.socket.on("open", () => {
      manager.onConnectionClosed(connection, listener);
      connection.socket.close(1000, "Normal Closure");
    });

    connection.socket.on("error", (error) => {
      console.error("WebSocket error:", error);
      done(error);
    });
  });
});
