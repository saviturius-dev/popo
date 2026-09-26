import type { LlmPort } from '@workflowos/core';
import { errors } from '@workflowos/core';
import { AnthropicProvider } from './anthropic.js';
import { FixtureProvider, type FixtureTable } from './fixture.js';
import { OllamaProvider } from './ollama.js';

export interface SelectLlmOptions {
  /** Explicit choice; otherwise resolved from the environment. */
  provider?: 'anthropic' | 'ollama' | 'fixture';
  fixtureTable?: FixtureTable;
  model?: string;
}

/**
 * Resolves the LLM implementation from configuration.
 *
 * There is deliberately no implicit "auto-upgrade to a cloud model": an offline
 * or fixture run stays offline and reproducible.
 */
export function selectLlm(options: SelectLlmOptions = {}): LlmPort {
  const provider = options.provider ?? detectProvider();
  switch (provider) {
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

function detectProvider(): 'anthropic' | 'ollama' | 'fixture' {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OLLAMA_BASE_URL) return 'ollama';
  return 'fixture';
}
