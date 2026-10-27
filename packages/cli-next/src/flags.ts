/**
 * Flags every command carries. Declared once so the parser and `--help` know
 * about them, while the behaviour is driven off the context — ADR-008 puts the
 * output mode on the context, and a handler that branched on its own flag
 * would be a second source of truth.
 */
export const commonFlags = {
  json: {
    kind: "boolean",
    brief: "Emit the machine-readable envelope",
    default: false,
  },
} as const;
