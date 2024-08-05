import { DataSerializationManager } from "../src/DataSerializationManager";

describe("DataSerializationManager", () => {
  let manager: DataSerializationManager;

  beforeEach(() => {
    manager = new DataSerializationManager();
  });

  test("should use default serialization strategy", () => {
    const message = { type: "test", content: "Hello, World!" };
    const serialized = manager.serializeMessage(message);
    expect(serialized).toBe(JSON.stringify(message));
  });

  test("should use default deserialization strategy", () => {
    const data = JSON.stringify({ type: "test", content: "Hello, World!" });
    const deserialized = manager.deserializeMessage(data);
    expect(deserialized).toEqual(JSON.parse(data));
  });

  test("should set and use custom serialization strategy", () => {
    const customStrategy = {
      serialize: (data: any): string => `custom:${JSON.stringify(data)}`,
    };

    manager.setSerializationStrategy(customStrategy);

    const message = { type: "test", content: "Hello, World!" };
    const serialized = manager.serializeMessage(message);
    expect(serialized).toBe(`custom:${JSON.stringify(message)}`);
  });

  test("should set and use custom deserialization strategy", () => {
    const customStrategy = {
      deserialize: (data: string): any =>
        JSON.parse(data.replace("custom:", "")),
    };

    manager.setDeserializationStrategy(customStrategy);

    const data = `custom:${JSON.stringify({
      type: "test",
      content: "Hello, World!",
    })}`;
    const deserialized = manager.deserializeMessage(data);
    expect(deserialized).toEqual({ type: "test", content: "Hello, World!" });
  });

  test("should use custom serialization strategy for specific message", () => {
    const customStrategy = {
      serialize: (data: any): string => `custom:${JSON.stringify(data)}`,
    };

    const message = { type: "test", content: "Hello, World!" };
    const serialized = manager.serializeMessage(message, customStrategy);
    expect(serialized).toBe(`custom:${JSON.stringify(message)}`);
  });

  test("should use custom deserialization strategy for specific data", () => {
    const customStrategy = {
      deserialize: (data: string): any =>
        JSON.parse(data.replace("custom:", "")),
    };

    const data = `custom:${JSON.stringify({
      type: "test",
      content: "Hello, World!",
    })}`;
    const deserialized = manager.deserializeMessage(data, customStrategy);
    expect(deserialized).toEqual({ type: "test", content: "Hello, World!" });
  });
});
