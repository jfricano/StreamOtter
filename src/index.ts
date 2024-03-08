import { DataSerializationManager } from './DataSerializationManager';

// Initialize the manager
const serializationManager = new DataSerializationManager();

// Example message
const message = { type: 'update', content: 'This is a test' };

// Serialize a message using the default strategy
const serializedMessage = serializationManager.serializeMessage(message);

// Assume we receive a serialized message
const receivedSerializedMessage =
  '{"type":"update","content":"Received message"}';

// Deserialize the message using the default strategy
const deserializedMessage = serializationManager.deserializeMessage(
  receivedSerializedMessage
);

console.log(deserializedMessage); // Output: { type: 'update', content: 'Received message' }
