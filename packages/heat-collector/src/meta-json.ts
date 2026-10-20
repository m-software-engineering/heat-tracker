/** Parses a stored `metaJson` value; anything unparseable becomes `{}`. */
export const safeParseMetaJson = (value: unknown) => {
  if (!value) return {} as Record<string, unknown>;
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {} as Record<string, unknown>;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
