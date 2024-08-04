// test/WebSocketManager.test.ts

import WebSocket from '../__mocks__/WebSocket'; // Adjust the path as necessary
import { WebSocketManager } from '../src/WebSocketManager';

declare global {
  interface WebSocket {
    mockReceiveMessage: (message: any) => void;
  }
}

// Reset the WebSocket mocks before each test
beforeEach(() => {
  WebSocket.resetMocks();
});

describe('WebSocketManager', () => {
  it('should establish a WebSocket connection', () => {
    const wsManager = new WebSocketManager();
    const url = 'ws://example.com';
    const connection = wsManager.createConnection(url);

    expect(WebSocket.instances.length).toBe(1);
    expect(WebSocket.instances[0].url).toBe(url);
    expect(connection.socket).toBeDefined();
  });

  it('should send a message through a WebSocket connection', () => {
    const wsManager = new WebSocketManager();
    const connection = wsManager.createConnection('ws://example.com');

    const message = { type: 'test', payload: 'Hello WebSocket' };
    wsManager.sendMessage(connection, message);

    expect(connection.socket.send).toHaveBeenCalledWith(
      JSON.stringify(message)
    );
  });

  it('should handle messages received from a WebSocket connection', (done) => {
    const wsManager = new WebSocketManager();
    const connection = wsManager.createConnection('ws://example.com');

    const testMessage = { type: 'test', payload: 'Hello WebSocket' };

    wsManager.onMessage(connection, (message) => {
      expect(message).toEqual(testMessage);
      done();
    });

    connection.socket.mockReceiveMessage(testMessage);
  });

  it('should close a WebSocket connection', () => {
    const wsManager = new WebSocketManager();
    const connection = wsManager.createConnection('ws://example.com');
    const code = 1000;
    const reason = 'Normal closure';

    wsManager.closeConnection(connection, code, reason);

    expect(connection.socket.onclose).toHaveBeenCalled();
  });

  // Additional tests can be added here for reconnection logic, etc.
});
