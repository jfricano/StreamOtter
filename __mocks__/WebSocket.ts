// __mocks__/WebSocket.ts
class WebSocket {
  static instances: WebSocket[] = [];

  static resetMocks() {
    WebSocket.instances = [];
  }

  onopen?: () => void;
  onmessage?: (event: { data: any }) => void;
  onclose?: (event: { code: number; reason: string }) => void;
  send = jest.fn();

  constructor(public url: string) {
    WebSocket.instances.push(this);
  }

  close(code?: number, reason?: string) {
    if (this.onclose) {
      this.onclose({ code: code || 1000, reason: reason || '' });
    }
  }

  // Simulate receiving a message
  mockReceiveMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

export default WebSocket;
