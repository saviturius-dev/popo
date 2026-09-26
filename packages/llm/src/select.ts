import type { LlmPort } from '@workflowos/core';
import { errors } from '@workflowos/core';
import { AnthropicProvider } from './anthropic.js';
import { FixtureProvider, type FixtureTable } from './fixture.js';
import { OllamaProvider } from './ollama.js';
import { NvidiaProvider } from './nvidia.js';

export interface SelectLlmOptions {
  /** Explicit choice; otherwise resolved from the environment. */
  provider?: 'nvidia' | 'anthropic' | 'ollama' | 'fixture';
  fixtureTable?: FixtureTable;
  model?: string;
}

/**
 * Resolves the LLM implementation from configuration.
 */
export function selectLlm(options: SelectLlmOptions = {}): LlmPort {
  const provider = options.provider ?? detectProvider();
  switch (provider) {
    case 'nvidia':
      return new NvidiaProvider(options.model ? { model: options.model } : {});
    case 'anthropic':
      return new AnthropicProvider(options.model ? { model: options.model } : {});
    case 'ollama':
      return new OllamaProvider(options.model ? { model: options.model } : {});
    case 'fixture':
      return new FixtureProvider(options.fixtureTable ?? {});
    default:
      throw errors.llm('unknown_provider', `Unknown LLM provider "${provider}"`, { provider });
  }
}

function detectProvider(): 'nvidia' | 'anthropic' | 'ollama' | 'fixture' {
  if (process.env.NVIDIA_API_KEY || !process.env.ANTHROPIC_API_KEY) return 'nvidia';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OLLAMA_BASE_URL) return 'ollama';
  return 'fixture';
}
