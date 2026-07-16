// Tabela de referência de preços por 1M tokens (USD).
// Valores baseados nos preços públicos dos provedores no momento da escrita.
// Revise quando os preços do gateway mudarem.

export const USD_TO_BRL = 5.2;

interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICE_TABLE: Record<string, ModelPrice> = {
  "openai/gpt-5": { inputPer1M: 1.25, outputPer1M: 10.0 },
  "openai/gpt-5-mini": { inputPer1M: 0.25, outputPer1M: 2.0 },
  "openai/gpt-5-nano": { inputPer1M: 0.05, outputPer1M: 0.4 },
  "openai/gpt-5.2": { inputPer1M: 1.25, outputPer1M: 10.0 },
  "openai/gpt-5.4": { inputPer1M: 1.25, outputPer1M: 10.0 },
  "openai/gpt-5.4-mini": { inputPer1M: 0.25, outputPer1M: 2.0 },
  "openai/gpt-5.4-nano": { inputPer1M: 0.05, outputPer1M: 0.4 },
  "openai/gpt-5.5": { inputPer1M: 1.5, outputPer1M: 12.0 },
  "google/gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10.0 },
  "google/gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5 },
  "google/gemini-2.5-flash-lite": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "google/gemini-3-flash-preview": { inputPer1M: 0.3, outputPer1M: 2.5 },
  "google/gemini-3.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5 },
  "google/gemini-3.1-flash-lite": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "google/gemini-3.1-pro-preview": { inputPer1M: 1.25, outputPer1M: 10.0 },
};

const DEFAULT_PRICE: ModelPrice = { inputPer1M: 1.0, outputPer1M: 3.0 };

export function getModelPrice(model: string | null | undefined): ModelPrice {
  if (!model) return DEFAULT_PRICE;
  return PRICE_TABLE[model] ?? DEFAULT_PRICE;
}

export function estimateCostUsd(
  model: string | null | undefined,
  promptTokens: number,
  completionTokens: number,
): number {
  const price = getModelPrice(model);
  return (
    (promptTokens / 1_000_000) * price.inputPer1M +
    (completionTokens / 1_000_000) * price.outputPer1M
  );
}

export function estimateCostBrl(
  model: string | null | undefined,
  promptTokens: number,
  completionTokens: number,
): number {
  return estimateCostUsd(model, promptTokens, completionTokens) * USD_TO_BRL;
}

export function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatTokens(value: number): string {
  return value.toLocaleString("pt-BR");
}
