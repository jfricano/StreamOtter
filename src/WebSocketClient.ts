// WebSocketClient.ts
import { ConnectionOptions } from "./WebSocketManager";

interface WebSocketClientConnection {
  socket: WebSocket;
  url: string;
  options?: ConnectionOptions;
  // Add any additional properties needed for managing the connection
}

class WebSocketClient {
  createConnection(
    url: string,
    options?: ConnectionOptions
  ): WebSocketClientConnection {
    const socket = new WebSocket(url);

    socket.onopen = () => {
      console.log("WebSocket connection established");
    };

    const connection: WebSocketClientConnection = { socket, url, options };
    return connection;
  }

  sendMessage(connection: WebSocketClientConnection, message: any): void {
    const serializedMessage = JSON.stringify(message); // Simple serialization
    connection.socket.send(serializedMessage);
  }

  onMessage(
    connection: WebSocketClientConnection,
    listener: (message: any) => void
  ): void {
    connection.socket.onmessage = (event) => {
      const message = JSON.parse(event.data); // Simple deserialization
      listener(message);
    };
  }

  closeConnection(
    connection: WebSocketClientConnection,
    code?: number,
    reason?: string
  ): void {
    connection.socket.close(code, reason);
  }

  onConnectionClosed(
    connection: WebSocketClientConnection,
    listener: (code: number, reason: string) => void
  ): void {
    connection.socket.onclose = (event) => {
      listener(event.code, event.reason);
    };
  }
}

export { WebSocketClient, WebSocketClientConnection };
