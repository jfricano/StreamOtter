// Establish a WebSocket connection
const socket = new WebSocket("wss://example.com/socket");

socket.onopen = () => {
  console.log("WebSocket connection established");
  // Send a message to the server
  socket.send(
    JSON.stringify({ type: "greeting", payload: "Hello, WebSocket!" })
  );
};

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log("Received message:", message);
  // Handle the received message
};

socket.onclose = (event) => {
  console.log(`WebSocket connection closed: ${event.code} - ${event.reason}`);
};

socket.onerror = (error) => {
  console.error("WebSocket error:", error);
};
