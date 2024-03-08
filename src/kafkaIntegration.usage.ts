import {
  KafkaIntegrationManager,
  ProducerMessage,
} from './KafkaIntegrationManager';

const kafkaConfig = {
  clientId: 'my-app',
  brokers: ['kafka-broker:9092'],
};

const manager = new KafkaIntegrationManager(kafkaConfig);

// Producer example
(async () => {
  const producer = manager.createProducer();
  const message: ProducerMessage = { value: 'Hello Kafka' };
  await manager.sendMessage(producer, 'test-topic', message);
  console.log('Message sent successfully');
})().catch(console.error);

// Consumer example
const consumerConfig = { ...kafkaConfig, groupId: 'test-group' };
(async () => {
  const consumer = await manager.createConsumer(consumerConfig, 'test-topic');
  await manager.startConsumer(
    consumer,
    async ({ topic, partition, message }) => {
      console.log(`Received message: ${message.value?.toString()}`);
    }
  );
})().catch(console.error);
