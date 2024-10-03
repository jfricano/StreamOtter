import { WebSocketManager, WebSocketConnection } from "../src/WebSocketManager";
import WebSocket from "ws";

jest.mock("ws"); // Mock the ws library

describe("WebSocketManager", () => {
  let webSocketManager: WebSocketManager;
  let connection: WebSocketConnection;

  beforeEach(() => {
    webSocketManager = new WebSocketManager();
    connection = webSocketManager.createConnection("ws://test-url");
  });

  test("should create a WebSocket connection", () => {
    expect(connection.socket).toBeInstanceOf(WebSocket);
    expect(connection.url).toBe("ws://test-url");
  });

  test("should handle onOpen event", () => {
    const onOpenCallback = jest.spyOn(console, "log");
    connection.socket.onopen({} as any);
    expect(onOpenCallback).toHaveBeenCalledWith(
      "WebSocket connection established to ws://test-url"
    );
    onOpenCallback.mockRestore();
  });

  test("should handle onError event", () => {
    const onErrorCallback = jest.spyOn(console, "error");
    connection.socket.onerror(new Error("Test error") as any);
    expect(onErrorCallback).toHaveBeenCalledWith(
      "WebSocket error:",
      expect.any(Error)
    );
    connection.socket.close(); // Ensure closure on error
    onErrorCallback.mockRestore();
  });

  test("should handle onClose event", () => {
    const onCloseCallback = jest.spyOn(console, "log");
    connection.socket.onclose({ code: 1000, reason: "Normal closure" } as any);
    expect(onCloseCallback).toHaveBeenCalledWith(
      "WebSocket connection closed:",
      1000,
      "Normal closure"
    );
    onCloseCallback.mockRestore();
  });

  test("should send a message successfully", () => {
    const message = { type: "greeting", payload: "Hello" };
    connection.socket.send = jest.fn(); // Mock send method
    webSocketManager.sendMessage(connection, message);
    expect(connection.socket.send).toHaveBeenCalledWith(
      JSON.stringify(message)
    );
  });

  test("should throw an error when sending an invalid message", () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    connection.socket.send = jest.fn().mockImplementation(() => {
      throw new Error("Send failed");
    });

    webSocketManager.sendMessage(connection, { type: "error" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error sending message:",
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  test("should close the connection gracefully", () => {
    const closeSpy = jest.spyOn(connection.socket, "close");
    webSocketManager.closeConnection(connection);
    expect(closeSpy).toHaveBeenCalled();
  });

  test("should register a message listener", () => {
    const messageListener = jest.fn();
    webSocketManager.onMessage(connection, messageListener);

    const testMessage = JSON.stringify({ type: "response", data: "Test data" });
    connection.socket.onmessage({ data: testMessage } as any);

    expect(messageListener).toHaveBeenCalledWith({
      type: "response",
      data: "Test data",
    });
  });

  test("should handle unknown data type in onMessage", () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    const messageListener = jest.fn();
    webSocketManager.onMessage(connection, messageListener);

    connection.socket.onmessage({ data: 12345 } as any); // Sending a number instead of a string
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Unknown data type received in WebSocket message:",
      "number"
    );

    consoleErrorSpy.mockRestore();
  });

  // Additional tests can be added here to cover edge cases and more complex scenarios
});
