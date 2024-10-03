import { ConnectionResilienceManager } from "./ConnectionResilienceManager";
import WebSocket from "ws";

interface ConnectionOptions {
  reconnectionStrategy?: ReconnectionStrategy;
  messageParser?: (data: any) => any; // Option to specify a custom message parser
}

interface ReconnectionStrategy {
  maxRetries: number;
  retryDelay: number; // in milliseconds
  exponentialBackoff: boolean;
}

interface WebSocketConnection {
  socket: WebSocket;
  url: string;
  options?: ConnectionOptions;
}

class WebSocketManager {
  private readonly connectionResilienceManager =
    new ConnectionResilienceManager();

  createConnection(
    url: string,
    options?: ConnectionOptions
  ): WebSocketConnection {
    const socket = new WebSocket(url);

    socket.onopen = () => {
      console.log(`WebSocket connection established to ${url}`);
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      socket.close(); // Close connection on error
    };

    socket.onclose = (event) => {
      console.log("WebSocket connection closed:", event.code, event.reason);
    };

    const connection: WebSocketConnection = { socket, url, options };

    // If reconnection options are provided, configure and enable reconnection
    if (options?.reconnectionStrategy) {
      this.connectionResilienceManager.configureReconnection(
        connection,
        options.reconnectionStrategy
      );
      this.connectionResilienceManager.enableReconnection(connection);
    }

    return connection;
  }

  sendMessage(connection: WebSocketConnection, message: any): void {
    try {
      let serializedMessage: string | ArrayBuffer | Blob;
      if (typeof message === "string") {
        serializedMessage = message;
      } else if (message instanceof Buffer) {
        serializedMessage = message;
      } else if (message instanceof ArrayBuffer) {
        serializedMessage = message;
      } else if (
        Array.isArray(message) &&
        message.every((item) => item instanceof Buffer)
      ) {
        serializedMessage = Buffer.concat(message);
      } else {
        serializedMessage = JSON.stringify(message); // Default serialization
      }
      connection.socket.send(serializedMessage);
    } catch (error) {
      console.error("Error sending message:", error);
      connection.socket.close(); // Close connection on error
    }
  }

  closeConnection(
    connection: WebSocketConnection,
    code?: number,
    reason?: string
  ): void {
    connection.socket.close(code, reason);
  }

  onConnectionClosed(
    connection: WebSocketConnection,
    listener: (code: number, reason: string) => void
  ): void {
    connection.socket.onclose = (event) => {
      listener(event.code, event.reason);
    };
  }

  onMessage(
    connection: WebSocketConnection,
    listener: (message: any) => void
  ): void {
    connection.socket.onmessage = (event) => {
      let parsedMessage: any;
      try {
        // Use custom message parser if provided
        if (connection.options?.messageParser) {
          parsedMessage = connection.options.messageParser(event.data);
        } else {
          // Default parsing logic
          if (typeof event.data === "string") {
            parsedMessage = JSON.parse(event.data);
          } else if (event.data instanceof Buffer) {
            parsedMessage = JSON.parse(event.data.toString());
          } else if (event.data instanceof ArrayBuffer) {
            parsedMessage = JSON.parse(Buffer.from(event.data).toString());
          } else {
            console.error(
              "Unknown data type received in WebSocket message:",
              typeof event.data
            );
            return; // Exit on unknown type
          }
        }
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
        return; // Exit on parsing error
      }
      listener(parsedMessage); // Call the listener with the parsed message
    };
  }
}

export {
  WebSocketManager,
  ConnectionOptions,
  ReconnectionStrategy,
  WebSocketConnection,
};
