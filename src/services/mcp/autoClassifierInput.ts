/** Preserve nested browser targets, request bodies, and arrays for classification. */
export function mcpToolInputToAutoClassifierInput(input: Record<string, unknown>, toolName: string): string {
  return Object.keys(input).length ? JSON.stringify(input) : toolName;
}
