// src/SerializationStrategy.ts

interface SerializationStrategy {
  serialize(data: any): string | ArrayBuffer | Blob;
}

interface DeserializationStrategy {
  deserialize(data: string | ArrayBuffer | Blob): any;
}

export { SerializationStrategy, DeserializationStrategy };
