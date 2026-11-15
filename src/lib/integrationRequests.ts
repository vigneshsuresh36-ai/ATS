export type IntegrationProvider = "whatsapp" | "naukri" | "linkedin";
export function parseIntegrationRequest(value: unknown): { provider: IntegrationProvider; requested: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if ((input.provider !== "whatsapp" && input.provider !== "naukri" && input.provider !== "linkedin") || typeof input.requested !== "boolean") return null;
  return { provider: input.provider, requested: input.requested };
}
