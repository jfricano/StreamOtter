import { DataSerializationManager } from "../src/DataSerializationManager";

describe("DataSerializationManager", () => {
  let dataManager: DataSerializationManager;

  beforeEach(() => {
    dataManager = new DataSerializationManager();
  });

  test("should serialize a message using the default strategy", () => {
    const message = { key: "value" };
    const result = dataManager.serializeMessage(message);
    expect(result).toBe(JSON.stringify(message));
  });

  test("should deserialize a message using the default strategy", () => {
    const jsonString = JSON.stringify({ key: "value" });
    const result = dataManager.deserializeMessage(jsonString);
    expect(result).toEqual({ key: "value" });
  });

  test("should throw an error on serialization failure", () => {
    expect(() => {
      dataManager.serializeMessage(undefined); // Attempting to serialize undefined
    }).toThrow("Failed to serialize message.");
  });

  test("should throw an error on deserialization failure", () => {
    expect(() => {
      dataManager.deserializeMessage("invalid json"); // Invalid JSON string
    }).toThrow("Failed to deserialize message.");
  });

  test("should set a custom serialization strategy", () => {
    const customStrategy = {
      serialize: (data: any) => `Custom: ${data}`,
    };
    dataManager.setSerializationStrategy(customStrategy);
    const result = dataManager.serializeMessage("test");
    expect(result).toBe("Custom: test");
  });

  test("should throw an error for invalid custom serialization strategy", () => {
    expect(() => {
      // Passing an object without the required 'serialize' method
      dataManager.setSerializationStrategy({
        // Intentionally leaving out the 'serialize' method
      } as any); // Cast to 'any' to bypass TS checks
    }).toThrow(
      "Invalid serialization strategy: must implement 'serialize' method."
    );
  });

  test("should reset to default strategies", () => {
    const customStrategy = {
      serialize: (data: any) => `Custom: ${data}`,
    };
    dataManager.setSerializationStrategy(customStrategy);
    dataManager.resetToDefaultStrategies();
    const result = dataManager.serializeMessage("test");
    expect(result).toBe(JSON.stringify("test"));
  });
});
