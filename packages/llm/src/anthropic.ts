import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LlmPort, LlmRequest, LlmResponse } from '@workflowos/core';
import { errors } from '@workflowos/core';

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  maxRetries?: number;
  name?: string;
}

const TOOL_NAME = 'emit_structured_result';

export class AnthropicProvider implements LlmPort {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicProviderOptions = {}) {
    this.name = options.name ?? 'anthropic';
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw errors.llm('missing_api_key', 'ANTHROPIC_API_KEY is not set');
    }
    this.client = new Anthropic({
      apiKey,
      baseURL: options.baseURL,
      maxRetries: options.maxRetries ?? 2,
    });
  }

  async complete<S extends z.ZodTypeAny, T = z.infer<S>>(
    request: LlmRequest<S>,
  ): Promise<LlmResponse<T>> {
    const tool: Anthropic.Tool = {
      name: TOOL_NAME,
      description: 'Return the structured result. This is the only valid way to respond.',
      input_schema: zodToJsonSchema(request.schema, { $refStrategy: 'none' }) as Anthropic.Tool['input_schema'],
    };

    let message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 2000,
        system: request.system,
        tools: [tool],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: request.prompt }],
      });
    } catch (cause) {
      throw errors.llm('request_failed', `Anthropic request failed: ${String(cause)}`, {
        model: this.model,
        cause: String(cause),
      });
    }

    const block = message.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      throw errors.llm('no_tool_use', 'Model did not return the required structured result', {
        stopReason: message.stop_reason ?? null,
      });
    }

    const parsed = request.schema.safeParse(block.input);
    if (!parsed.success) {
      throw errors.llm('schema_violation', 'Structured result failed schema validation', {
        issues: parsed.error.issues,
      });
    }

    return {
      value: parsed.data as T,
      provider: this.name,
      model: this.model,
      degraded: false,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  }
}
