/** Customization
 * You can further customize the serialization and deserialization process by implementing and setting custom strategies.
 * This allows your library to handle a wide range of data formats and use cases, making it adaptable to different backend systems and data structures.
 */

interface SerializationStrategy {
  serialize(data: any): string | ArrayBuffer | Blob;
}

interface DeserializationStrategy {
  deserialize(data: string | ArrayBuffer | Blob): any;
}

class DataSerializationManager {
  private serializationStrategy: SerializationStrategy;
  private deserializationStrategy: DeserializationStrategy;

  constructor() {
    // Set default strategies
    this.serializationStrategy = {
      serialize: (data: any): string => {
        if (data === undefined) {
          throw new Error("Cannot serialize undefined.");
        }
        return JSON.stringify(data);
      },
    };

    this.deserializationStrategy = {
      deserialize: (data: string): any => JSON.parse(data),
    };
  }

  setSerializationStrategy(strategy: SerializationStrategy): void {
    if (strategy && typeof strategy.serialize === "function") {
      this.serializationStrategy = strategy;
    } else {
      throw new Error(
        "Invalid serialization strategy: must implement 'serialize' method."
      );
    }
  }

  setDeserializationStrategy(strategy: DeserializationStrategy): void {
    if (strategy && typeof strategy.deserialize === "function") {
      this.deserializationStrategy = strategy;
    } else {
      throw new Error(
        "Invalid deserialization strategy: must implement 'deserialize' method."
      );
    }
  }

  resetToDefaultStrategies(): void {
    this.serializationStrategy = {
      serialize: (data: any): string => {
        if (data === undefined) {
          throw new Error("Cannot serialize undefined.");
        }
        return JSON.stringify(data);
      },
    };
    this.deserializationStrategy = {
      deserialize: (data: string): any => JSON.parse(data),
    };
  }

  serializeMessage(
    message: any,
    customStrategy?: SerializationStrategy
  ): string | ArrayBuffer | Blob {
    try {
      if (customStrategy) {
        return customStrategy.serialize(message);
      }
      return this.serializationStrategy.serialize(message);
    } catch (error) {
      console.error("Serialization error:", error);
      throw new Error("Failed to serialize message.");
    }
  }

  deserializeMessage(
    data: string | ArrayBuffer | Blob,
    customStrategy?: DeserializationStrategy
  ): any {
    try {
      if (customStrategy) {
        return customStrategy.deserialize(data);
      }
      return this.deserializationStrategy.deserialize(data);
    } catch (error) {
      console.error("Deserialization error:", error);
      throw new Error("Failed to deserialize message.");
    }
  }
}

export { DataSerializationManager };
