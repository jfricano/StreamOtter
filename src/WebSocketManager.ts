// src/WebSocketManager.ts

interface ConnectionOptions {
  // Define other options as needed, e.g., reconnection strategies, serialization/deserialization functions
  reconnectionStrategy?: ReconnectionStrategy;
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
  // Add any additional properties needed for managing the connection
}

class WebSocketManager {
  createConnection(
    url: string,
    options?: ConnectionOptions
  ): WebSocketConnection {
    const socket = new WebSocket(url);

    // You can extend this to handle events (open, message, error, close) as per your API design.
    socket.onopen = () => {
      console.log('WebSocket connection established');
    };

    const connection: WebSocketConnection = { socket, url, options };
    return connection;
  }

  sendMessage(connection: WebSocketConnection, message: any): void {
    // Here, you can implement serialization based on the connection options if needed
    const serializedMessage = JSON.stringify(message); // Simple serialization
    connection.socket.send(serializedMessage);
  }

  onMessage(
    connection: WebSocketConnection,
    listener: (message: any) => void
  ): void {
    connection.socket.onmessage = (event) => {
      // Here, you can implement deserialization based on the connection options if needed
      const message = JSON.parse(event.data); // Simple deserialization
      listener(message);
    };
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
      // Implement reconnection logic here based on the connection options if needed
    };
  }

  
}

export {
  WebSocketManager,
  ConnectionOptions,
  ReconnectionStrategy,
  WebSocketConnection,
};
