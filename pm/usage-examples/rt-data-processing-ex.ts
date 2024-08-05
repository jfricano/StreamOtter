// example 1

import { WebSocketManager, KafkaIntegrationManager } from "stream-otter";

// Set up Kafka
const kafkaProducerConfig = {
  /* Kafka producer configuration */
};
const kafkaConsumerConfig = {
  /* Kafka consumer configuration */
};
const kafkaManager = new KafkaIntegrationManager();
const producer = kafkaManager.createProducer(kafkaProducerConfig);
const consumer = kafkaManager.createConsumer(
  kafkaConsumerConfig,
  ["events"],
  (message) => {
    console.log("Received event:", message);
    // Process message and send to WebSocket clients
  }
);

// Set up WebSocket server
const wsManager = new WebSocketManager();
const connection = wsManager.createConnection("wss://example.com", {
  reconnectionStrategy: {
    maxRetries: 5,
    retryDelay: 1000,
    exponentialBackoff: true,
  },
});

wsManager.onMessage(connection, (message) => {
  console.log("Received message from client:", message);
  // Process message and produce to Kafka
  kafkaManager.sendMessage(producer, "events", {
    key: "clientMessage",
    value: message,
  });
});

wsManager.sendMessage(connection, {
  type: "greeting",
  payload: "Hello, WebSocket!",
});
