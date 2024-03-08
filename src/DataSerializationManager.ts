// src/DataSerializationManager.ts
import {
  SerializationStrategy,
  DeserializationStrategy,
} from './SerializationStrategy';

class DataSerializationManager {
  private serializationStrategy: SerializationStrategy;
  private deserializationStrategy: DeserializationStrategy;

  constructor() {
    // Set default strategies
    this.serializationStrategy = {
      serialize: (data: any): string => JSON.stringify(data),
    };

    this.deserializationStrategy = {
      deserialize: (data: string): any => JSON.parse(data),
    };
  }

  setSerializationStrategy(strategy: SerializationStrategy): void {
    this.serializationStrategy = strategy;
  }

  setDeserializationStrategy(strategy: DeserializationStrategy): void {
    this.deserializationStrategy = strategy;
  }

  serializeMessage(
    message: any,
    customStrategy?: SerializationStrategy
  ): string | ArrayBuffer | Blob {
    if (customStrategy) {
      return customStrategy.serialize(message);
    }
    return this.serializationStrategy.serialize(message);
  }

  deserializeMessage(
    data: string | ArrayBuffer | Blob,
    customStrategy?: DeserializationStrategy
  ): any {
    if (customStrategy) {
      return customStrategy.deserialize(data);
    }
    return this.deserializationStrategy.deserialize(data);
  }
}

export { DataSerializationManager };
