export const MAX_DIAGRAM_CHARACTERS = 20_000;
export const MAX_DIAGRAM_LINES = 500;

export function mermaidSourceError(source: string): string | null {
  if (
    source.length > MAX_DIAGRAM_CHARACTERS ||
    source.split("\n", MAX_DIAGRAM_LINES + 1).length > MAX_DIAGRAM_LINES
  ) {
    return "Diagram is too large to render safely";
  }
  if (/%%\s*\{/.test(source) || /^---\s*$/m.test(source)) {
    return "Diagram configuration directives are not supported";
  }
  return null;
}
