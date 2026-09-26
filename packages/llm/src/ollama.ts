import type { z } from 'zod';
import type { LlmPort, LlmRequest, LlmResponse } from '@workflowos/core';
import { errors } from '@workflowos/core';

export interface OllamaProviderOptions {
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Local-model provider for offline/private operation. Expects the model to
 * honour a JSON-schema-constrained request; because small local models are
 * unreliable at that, the response is validated and the resilient wrapper will
 * fall back to heuristics if it fails.
 */
export class OllamaProvider implements LlmPort {
  readonly name = 'ollama';
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaProviderOptions = {}) {
    this.model = options.model ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:7b';
    this.baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async complete<S extends z.ZodTypeAny, T = z.infer<S>>(
    request: LlmRequest<S>,
  ): Promise<LlmResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: 'json',
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: `${request.system}\nRespond with JSON only.` },
            { role: 'user', content: request.prompt },
          ],
        }),
      });
      if (!res.ok) {
        throw errors.llm('request_failed', `Ollama returned ${res.status}`, { status: res.status });
      }
      const body = (await res.json()) as { message?: { content?: string } };
      const text = body.message?.content;
      if (!text) throw errors.llm('empty_response', 'Ollama returned no content');
      const parsed = request.schema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw errors.llm('schema_violation', 'Ollama output failed schema validation', {
          issues: parsed.error.issues,
        });
      }
      return {
        value: parsed.data as T,
        provider: this.name,
        model: this.model,
        degraded: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
