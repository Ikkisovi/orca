import { CostBreakdown, TokenUsage } from '../types';

export interface ModelPricingRate {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

// Pricing per million tokens (USD)
export const MODEL_PRICING_TABLE: Record<string, ModelPricingRate> = {
  // OpenAI & Codex
  'gpt-5.6-sol': { inputPerMillion: 2.5, outputPerMillion: 10.0, cacheReadPerMillion: 1.25 },
  'gpt-5.6-terra': { inputPerMillion: 1.5, outputPerMillion: 6.0, cacheReadPerMillion: 0.75 },
  'gpt-5.6-luna': { inputPerMillion: 0.5, outputPerMillion: 2.0, cacheReadPerMillion: 0.25 },
  'gpt-5.5': { inputPerMillion: 2.0, outputPerMillion: 8.0, cacheReadPerMillion: 1.0 },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0, cacheReadPerMillion: 1.25 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6, cacheReadPerMillion: 0.075 },
  'o1': { inputPerMillion: 15.0, outputPerMillion: 60.0, cacheReadPerMillion: 7.5 },
  'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4, cacheReadPerMillion: 0.55 },

  // Anthropic Claude
  'claude-opus-5': { inputPerMillion: 15.0, outputPerMillion: 75.0, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
  'claude-opus-4-6': { inputPerMillion: 15.0, outputPerMillion: 75.0, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
  'claude-opus-4-6-thinking': { inputPerMillion: 15.0, outputPerMillion: 75.0, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
  'claude-3-opus': { inputPerMillion: 15.0, outputPerMillion: 75.0, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
  'claude-3-7-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-sonnet-4-6': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-sonnet-4-6-thinking': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-3-5-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  'claude-3-5-haiku': { inputPerMillion: 0.8, outputPerMillion: 4.0, cacheReadPerMillion: 0.08, cacheWritePerMillion: 1.0 },

  // Google Gemini
  'gemini-3.7-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4, cacheReadPerMillion: 0.025 },
  'gemini-3.7-flash-high': { inputPerMillion: 0.1, outputPerMillion: 0.4, cacheReadPerMillion: 0.025 },
  'gemini-3.7-flash-tiered': { inputPerMillion: 0.1, outputPerMillion: 0.4, cacheReadPerMillion: 0.025 },
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.0, cacheReadPerMillion: 0.3125 },
  'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4, cacheReadPerMillion: 0.025 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.0, cacheReadPerMillion: 0.3125 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3, cacheReadPerMillion: 0.01875 },

  // DeepSeek
  'deepseek-v4-flash': { inputPerMillion: 0.14, outputPerMillion: 0.28, cacheReadPerMillion: 0.014 },
  'deepseek-v4-pro': { inputPerMillion: 0.27, outputPerMillion: 1.10, cacheReadPerMillion: 0.07 },
  'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28, cacheReadPerMillion: 0.014 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19, cacheReadPerMillion: 0.14 },

  // xAI Grok
  'grok-4.6': { inputPerMillion: 2.0, outputPerMillion: 10.0, cacheReadPerMillion: 0.5 },
  'grok-beta': { inputPerMillion: 5.0, outputPerMillion: 15.0 },

  // Kimi / Moonshot / MiniMax / AliZD
  'k3': { inputPerMillion: 0.2, outputPerMillion: 0.8, cacheReadPerMillion: 0.05 },
  'kimi-k2': { inputPerMillion: 0.2, outputPerMillion: 0.8, cacheReadPerMillion: 0.05 },
  'minimax-01': { inputPerMillion: 0.2, outputPerMillion: 1.1, cacheReadPerMillion: 0.05 },
  'muse-spark-1.2': { inputPerMillion: 0.1, outputPerMillion: 0.2, cacheReadPerMillion: 0.01 },
  'muse-spark-1.2-contributor': { inputPerMillion: 0.0, outputPerMillion: 0.0, cacheReadPerMillion: 0.0 },
  'muse-spark-1.2-contributor-free': { inputPerMillion: 0.0, outputPerMillion: 0.0, cacheReadPerMillion: 0.0 },
  'ox-alpha-free': { inputPerMillion: 0.0, outputPerMillion: 0.0, cacheReadPerMillion: 0.0 },
  'glm-5.2:free': { inputPerMillion: 0.0, outputPerMillion: 0.0, cacheReadPerMillion: 0.0 },
};

export function findModelPricing(modelName: string): ModelPricingRate {
  if (!modelName) {
    return { inputPerMillion: 0.5, outputPerMillion: 2.0, cacheReadPerMillion: 0.1 };
  }

  const clean = modelName.toLowerCase().trim().replace(/^[^/]+\//, ''); // strip provider/ prefix

  if (clean.includes('free') || clean.includes('contributor-free')) {
    return { inputPerMillion: 0, outputPerMillion: 0, cacheReadPerMillion: 0 };
  }

  if (MODEL_PRICING_TABLE[clean]) {
    return MODEL_PRICING_TABLE[clean];
  }

  // Fuzzy prefix matching
  for (const [key, rate] of Object.entries(MODEL_PRICING_TABLE)) {
    if (clean.includes(key) || key.includes(clean)) {
      return rate;
    }
  }

  // Generic fallback based on keywords
  if (clean.includes('opus')) return MODEL_PRICING_TABLE['claude-3-opus'];
  if (clean.includes('sonnet')) return MODEL_PRICING_TABLE['claude-3-5-sonnet'];
  if (clean.includes('haiku')) return MODEL_PRICING_TABLE['claude-3-5-haiku'];
  if (clean.includes('sol')) return MODEL_PRICING_TABLE['gpt-5.6-sol'];
  if (clean.includes('terra')) return MODEL_PRICING_TABLE['gpt-5.6-terra'];
  if (clean.includes('luna')) return MODEL_PRICING_TABLE['gpt-5.6-luna'];
  if (clean.includes('flash')) return MODEL_PRICING_TABLE['gemini-3.7-flash'];
  if (clean.includes('deepseek')) return MODEL_PRICING_TABLE['deepseek-v4-flash'];
  if (clean.includes('grok')) return MODEL_PRICING_TABLE['grok-4.6'];

  return { inputPerMillion: 0.5, outputPerMillion: 2.0, cacheReadPerMillion: 0.1 };
}

export function calculateCost(tokens: TokenUsage, modelName: string): CostBreakdown {
  const pricing = findModelPricing(modelName);
  const inputCost = (tokens.input / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (tokens.output / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost = (tokens.cacheRead / 1_000_000) * (pricing.cacheReadPerMillion ?? (pricing.inputPerMillion * 0.1));
  const cacheWriteCost = (tokens.cacheWrite / 1_000_000) * (pricing.cacheWritePerMillion ?? (pricing.inputPerMillion * 1.25));
  const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;

  return {
    inputCost: Math.round(inputCost * 1_000_000) / 1_000_000,
    outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
    cacheReadCost: Math.round(cacheReadCost * 1_000_000) / 1_000_000,
    cacheWriteCost: Math.round(cacheWriteCost * 1_000_000) / 1_000_000,
    totalCost: Math.round(totalCost * 1_000_000) / 1_000_000
  };
}
