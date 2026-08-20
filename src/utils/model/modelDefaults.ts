export const MYTABULON_DEFAULT_MODEL = "maximo-atlas-1.2";
export const RETIRED_MYTABULON_MODEL = "maximo-atlas-preview";
// Atlas 1.1 leaves the Maximo AI provider on 2026-08-21; existing selections
// and any catalog hits must resolve to Atlas 1.2.
export const RETIRED_MYTABULON_MODELS = [
  "maximo-atlas-preview",
  "maximo-atlas-1.1",
  "atlas-1.1",
];
export const RETIRED_MYTABULON_MODEL_SET = new Set(RETIRED_MYTABULON_MODELS);

/** Keep old saved selections from sending a retired model to the provider. */
export function normalizeRetiredMytabulonModel(value: string | undefined): string | undefined {
  if (value !== undefined && RETIRED_MYTABULON_MODEL_SET.has(value)) {
    return MYTABULON_DEFAULT_MODEL;
  }
  return value;
}

/** Prefer the current Atlas model without ever selecting a retired ID. */
export function chooseMytabulonDefaultModel(modelIds: readonly string[]): string {
  return modelIds.find((id) => id === MYTABULON_DEFAULT_MODEL) ??
    modelIds.find((id) => !RETIRED_MYTABULON_MODEL_SET.has(id)) ??
    MYTABULON_DEFAULT_MODEL;
}
