// src/KafkaIntegrationManager.ts
import {
  Kafka,
  Producer,
  Consumer,
  KafkaConfig,
  ProducerRecord,
  EachMessagePayload,
} from 'kafkajs';

interface KafkaProducerConfig extends KafkaConfig {
  // Extend with additional properties if needed
}

interface KafkaConsumerConfig extends KafkaConfig {
  groupId: string; // Essential for Kafka consumers
  // Extend with additional properties if needed
}

interface ProducerMessage {
  value: string; // Simple representation, extend according to your needs
}

class KafkaIntegrationManager {
  private kafka: Kafka;

  constructor(config: KafkaConfig) {
    this.kafka = new Kafka(config);
  }

  createProducer(config?: KafkaProducerConfig): Producer {
    return this.kafka.producer(config);
  }

  async sendMessage(
    producer: Producer,
    topic: string,
    messages: ProducerMessage[] | ProducerMessage
  ): Promise<void> {
    const records: ProducerRecord = {
      topic,
      messages: Array.isArray(messages) ? messages : [messages],
    };
    await producer.connect();
    await producer.send(records);
    await producer.disconnect();
  }

  async createConsumer(
    config: KafkaConsumerConfig,
    topics: string | string[]
  ): Promise<Consumer> {
    const consumer = this.kafka.consumer(config);
    const topicsToSubscribe = Array.isArray(topics) ? topics : [topics];

    for (const topic of topicsToSubscribe) {
      await consumer.subscribe({ topic, fromBeginning: true });
    }
    // topicsToSubscribe.forEach(async (topic) => {
    //   await consumer.subscribe({ topic, fromBeginning: true });
    // });
    return consumer;
  }

  async startConsumer(
    consumer: Consumer,
    messageHandler: (payload: EachMessagePayload) => void
  ): Promise<void> {
    await consumer.run({
      eachMessage: async (payload) => {
        messageHandler(payload);
      },
    });
  }

  async stopConsumer(consumer: Consumer): Promise<void> {
    await consumer.disconnect();
  }
}

export {
  KafkaIntegrationManager,
  KafkaProducerConfig,
  KafkaConsumerConfig,
  ProducerMessage,
};
