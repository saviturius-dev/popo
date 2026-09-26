import type { z } from 'zod';
import type { LlmPort, LlmRequest, LlmResponse } from '@workflowos/core';
import { errors } from '@workflowos/core';

export interface NvidiaProviderOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
}

/**
 * NVIDIA NIM / OpenAI-compatible chat completion provider.
 * Supports NVIDIA API Catalog models (e.g. moonshotai/kimi-k3, meta/llama-3.3-70b-instruct).
 */
export class NvidiaProvider implements LlmPort {
  readonly name = 'nvidia';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseURL: string;
  private readonly timeoutMs: number;

  constructor(options: NvidiaProviderOptions = {}) {
    this.apiKey =
      options.apiKey ??
      process.env.NVIDIA_API_KEY ??
      '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';
    this.model = options.model ?? process.env.NVIDIA_MODEL ?? 'moonshotai/kimi-k3';
    this.baseURL = options.baseURL ?? process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async complete<S extends z.ZodTypeAny, T = z.infer<S>>(
    request: LlmRequest<S>,
  ): Promise<LlmResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: `${request.system}\nYou MUST return your answer as pure, valid JSON conforming to the requested schema. Do not enclose in markdown blocks. Output raw JSON only.`,
            },
            {
              role: 'user',
              content: request.prompt,
            },
          ],
          temperature: 0.1,
          max_tokens: request.maxTokens ?? 4096,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw errors.llm('request_failed', `NVIDIA API returned ${response.status}: ${errorText}`, {
          status: response.status,
          response: errorText,
        });
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const rawContent = data.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw errors.llm('empty_response', 'NVIDIA API returned no content in message');
      }

      // Clean up markdown block fences if model wrapped the JSON
      const jsonText = rawContent
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      let jsonParsed: unknown;
      try {
        jsonParsed = JSON.parse(jsonText);
      } catch (jsonErr) {
        throw errors.llm('parse_failed', `Failed to parse NVIDIA response as JSON: ${String(jsonErr)}`, {
          raw: rawContent,
        });
      }

      const validated = request.schema.safeParse(jsonParsed);
      if (!validated.success) {
        throw errors.llm('schema_violation', 'NVIDIA API output failed schema validation', {
          issues: validated.error.issues,
          raw: rawContent,
        });
      }

      return {
        value: validated.data as T,
        provider: this.name,
        model: this.model,
        degraded: false,
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
