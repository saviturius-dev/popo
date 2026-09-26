import type { BusEvent, EventPublisher } from './ports.js';

export class EventBus implements EventPublisher {
  private listeners = new Set<(event: BusEvent) => void>();
  private historyLimit: number;
  private history: BusEvent[] = [];

  constructor(historyLimit = 500) {
    this.historyLimit = historyLimit;
  }

  publish(event: BusEvent): void {
    this.history.push(event);
    if (this.history.length > this.historyLimit) this.history.shift();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A misbehaving subscriber must never break the pipeline.
      }
    }
  }

  subscribe(listener: (event: BusEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  recent(count = 100): BusEvent[] {
    return this.history.slice(-count);
  }
}
