import { SecurityManager } from "stream-otter";

// Set up WebSocket security
const wsSecurityOptions = {
  wss: true,
  sslCertPath: "/path/to/cert",
  sslKeyPath: "/path/to/key",
};
const securityManager = new SecurityManager();
securityManager.configureWebSocketSecurity(wsSecurityOptions);

// Set up Kafka security
const kafkaSecurityOptions = {
  ssl: {
    rejectUnauthorized: true,
    ca: ["/path/to/ca-cert"],
    key: "/path/to/client-key",
    cert: "/path/to/client-cert",
  },
  sasl: {
    mechanism: "plain",
    username: "user",
    password: "password",
  },
};
securityManager.configureKafkaSecurity(kafkaSecurityOptions);
