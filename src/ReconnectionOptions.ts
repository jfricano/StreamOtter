// src/ReconnectionOptions.ts

export interface ReconnectionOptions {
  maxRetries: number;
  retryDelay: number;
  exponentialBackoff: boolean;
}
