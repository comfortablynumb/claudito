/**
 * Supported Claude models for agent execution
 */

export const SUPPORTED_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
] as const;

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

export const DEFAULT_MODEL: SupportedModel = 'claude-sonnet-4-6';

export const MODEL_DISPLAY_NAMES: Record<SupportedModel, string> = {
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
};

export function isValidModel(model: string): model is SupportedModel {
  return SUPPORTED_MODELS.includes(model as SupportedModel);
}

export function getModelDisplayName(model: string): string {
  if (isValidModel(model)) {
    return MODEL_DISPLAY_NAMES[model];
  }

  return model;
}
