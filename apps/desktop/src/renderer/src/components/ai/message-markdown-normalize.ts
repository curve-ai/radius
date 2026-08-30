const TABLE_CELL_SEPARATOR = /[|│]/;
const TABLE_RULE_CHARACTERS = /^[|│+┼╋─━═:=-]+$/;
const RADIUS_DIRECTIVE_OPEN =
  /^(\s*:::(?:caution|details|important|note|tip|warning))\s+(.+?)\s*$/i;

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^[|│]\s*/, "")
    .replace(/\s*[|│]$/, "")
    .split(TABLE_CELL_SEPARATOR)
    .map((cell) => cell.trim());
}

function isTableRule(line: string, columnCount: number): boolean {
  const compact = line.replace(/\s/g, "");
  if (!compact || !TABLE_RULE_CHARACTERS.test(compact)) return false;

  const junctionCount = compact.match(/[|│+┼╋]/g)?.length ?? 0;
  return junctionCount >= columnCount - 1;
}

function markdownTableRow(cells: readonly string[]): string {
  return `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
}

export function tableRowsAsMarkdown(
  rows: readonly (readonly string[])[],
): string {
  const header = rows[0];
  if (!header || header.length === 0) return "";

  return [
    markdownTableRow(header),
    markdownTableRow(header.map(() => "---")),
    ...rows.slice(1).map(markdownTableRow),
  ].join("\n");
}

export function normalizeMessageMarkdown(
  markdown: string,
  { streaming = false }: { streaming?: boolean } = {},
): string {
  const lines = markdown.split("\n");
  const normalized: string[] = [];
  let fence: { character: string; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      if (!fence) {
        fence = { character: marker[0] ?? "", length: marker.length };
      } else if (
        marker[0] === fence.character &&
        marker.length >= fence.length &&
        /^\s*(`{3,}|~{3,})\s*$/.test(line)
      ) {
        fence = null;
      }
      normalized.push(line);
      continue;
    }

    if (fence) {
      normalized.push(line);
      continue;
    }

    const directiveMatch = line.match(RADIUS_DIRECTIVE_OPEN);
    if (directiveMatch) {
      const opening = directiveMatch[1] ?? ":::note";
      const title = (directiveMatch[2] ?? "").replaceAll("]", "\\]");
      normalized.push(`${opening}[${title}]`);
      continue;
    }

    const rule = lines[index + 1];
    if (rule === undefined || !TABLE_CELL_SEPARATOR.test(line)) {
      normalized.push(line);
      continue;
    }

    const header = splitTableRow(line);
    if (header.length < 2 || !isTableRule(rule, header.length)) {
      normalized.push(line);
      continue;
    }

    const rows: string[][] = [];
    let cursor = index + 2;
    while (cursor < lines.length) {
      const rowLine = lines[cursor] ?? "";
      if (!rowLine.trim()) break;

      const row = TABLE_CELL_SEPARATOR.test(rowLine)
        ? splitTableRow(rowLine)
        : streaming && cursor === lines.length - 1
          ? [rowLine.trim()]
          : [];
      if (
        row.length === 0 ||
        row.length > header.length ||
        (!streaming && row.length !== header.length)
      ) {
        break;
      }
      rows.push([
        ...row,
        ...Array.from({ length: header.length - row.length }, () => ""),
      ]);
      cursor += 1;
    }

    if (rows.length === 0 && !streaming) {
      normalized.push(line);
      continue;
    }

    normalized.push(tableRowsAsMarkdown([header, ...rows]));
    index = cursor - 1;
  }

  return normalized.join("\n");
}
