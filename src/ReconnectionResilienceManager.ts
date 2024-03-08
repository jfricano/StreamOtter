// src/ConnectionResilienceManager.ts
import { WebSocketConnection } from './WebSocketManager';
import { ReconnectionOptions } from './ReconnectionOptions';

export class ConnectionResilienceManager {
  configureReconnection(
    connection: WebSocketConnection,
    options?: ReconnectionOptions
  ): void {
    // Ensure connection.options exists before assigning to it
    if (!connection.options) {
      connection.options = {};
    }

    // Now safely assign reconnectionStrategy to connection.options
    connection.options.reconnectionStrategy = options;
  }

  enableReconnection(connection: WebSocketConnection): void {
    if (!connection.options?.reconnectionStrategy) {
      console.warn('Reconnection strategy not configured for this connection.');
      return;
    }
    const { reconnectionStrategy } = connection.options;

    let attempts = 0;
    const attemptReconnect = () => {
      if (attempts < reconnectionStrategy.maxRetries) {
        setTimeout(() => {
          console.log(`Reconnection attempt ${attempts + 1}`);
          // Simulate reconnection logic
          // In a real scenario, you would try to reconnect the WebSocket here
          attempts++;
          attemptReconnect();
        }, this.getRetryDelay(attempts, reconnectionStrategy));
      } else {
        console.log('Max reconnection attempts reached.');
      }
    };

    connection.socket.onclose = () => {
      console.log('Connection closed. Attempting to reconnect...');
      attemptReconnect();
    };
  }

  disableReconnection(connection: WebSocketConnection): void {
    connection.socket.onclose = null;
  }

  private getRetryDelay(attempt: number, options: ReconnectionOptions): number {
    if (options.exponentialBackoff) {
      return Math.pow(2, attempt) * options.retryDelay;
    } else {
      return options.retryDelay;
    }
  }
}
