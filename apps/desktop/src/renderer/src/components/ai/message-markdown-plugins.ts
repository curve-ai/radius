type MarkdownNode = {
  type?: string;
  name?: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    directiveLabel?: boolean;
    hName?: string;
    hProperties?: Record<string, string>;
  };
};

const SUPPORTED_DIRECTIVES = new Set([
  "caution",
  "details",
  "important",
  "note",
  "tip",
  "warning",
]);

function nodeText(node: MarkdownNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

function visitDirectives(node: MarkdownNode): void {
  if (
    node.type === "containerDirective" ||
    node.type === "leafDirective" ||
    node.type === "textDirective"
  ) {
    const name = node.name?.toLowerCase() || "unknown";
    const firstChild = node.children?.[0];
    const title = firstChild?.data?.directiveLabel
      ? nodeText(firstChild).trim()
      : "";
    if (firstChild?.data?.directiveLabel) {
      node.children = node.children?.slice(1);
    }
    const data = node.data ?? (node.data = {});
    data.hName = "div";
    data.hProperties = {
      "data-radius-directive": SUPPORTED_DIRECTIVES.has(name)
        ? name
        : "unknown",
      "data-radius-directive-name": name,
      "data-radius-directive-title": title,
    };
  }

  for (const child of node.children ?? []) visitDirectives(child);
}

export function remarkRadiusDirectives(): (tree: MarkdownNode) => undefined {
  return (tree) => {
    visitDirectives(tree);
    return undefined;
  };
}
