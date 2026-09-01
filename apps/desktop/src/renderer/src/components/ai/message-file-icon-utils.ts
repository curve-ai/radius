export type MessageFileIconKind =
  | "archive"
  | "astro"
  | "c"
  | "cpp"
  | "csharp"
  | "database"
  | "docker"
  | "document"
  | "file"
  | "go"
  | "html"
  | "image"
  | "java"
  | "javascript"
  | "json"
  | "markdown"
  | "npm"
  | "pdf"
  | "python"
  | "react"
  | "rust"
  | "shell"
  | "stylesheet"
  | "table"
  | "toml"
  | "tsconfig"
  | "typescript"
  | "vue"
  | "xml"
  | "yaml";

export function messageFileName(href: string): string {
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    decoded = href;
  }
  const withoutLocation = (decoded.split("#", 1)[0] ?? decoded).replace(
    /:\d+(?::\d+)?$/,
    "",
  );
  return withoutLocation.split(/[\\/]/).at(-1) || withoutLocation;
}

export function messageFileIconKind(fileName: string): MessageFileIconKind {
  const lower = fileName.toLowerCase();
  if (/^package(?:-lock)?\.json$/.test(lower)) return "npm";
  if (/^tsconfig(?:\..+)?\.json$/.test(lower)) return "tsconfig";
  if (/^(?:dockerfile|compose\.ya?ml)$/.test(lower)) return "docker";
  const extension = lower.split(".").at(-1) ?? "";
  if (["ts", "mts", "cts"].includes(extension)) return "typescript";
  if (["tsx", "jsx"].includes(extension)) return "react";
  if (["js", "mjs", "cjs"].includes(extension)) return "javascript";
  if (extension === "json") return "json";
  if (["md", "mdx"].includes(extension)) return "markdown";
  if (["css", "scss", "sass", "less"].includes(extension)) return "stylesheet";
  if (["html", "htm"].includes(extension)) return "html";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(extension))
    return "image";
  if (extension === "pdf") return "pdf";
  if (extension === "py") return "python";
  if (extension === "rs") return "rust";
  if (extension === "go") return "go";
  if (extension === "java") return "java";
  if (["sh", "bash", "zsh", "fish"].includes(extension)) return "shell";
  if (["yaml", "yml"].includes(extension)) return "yaml";
  if (extension === "toml") return "toml";
  if (["xml", "plist"].includes(extension)) return "xml";
  if (extension === "vue") return "vue";
  if (extension === "astro") return "astro";
  if (extension === "c") return "c";
  if (["cc", "cpp", "cxx", "h", "hpp"].includes(extension)) return "cpp";
  if (["cs", "csproj"].includes(extension)) return "csharp";
  if (["db", "sqlite", "sqlite3", "sql"].includes(extension)) return "database";
  if (["csv", "tsv", "xls", "xlsx"].includes(extension)) return "table";
  if (["zip", "tar", "gz", "tgz", "rar", "7z"].includes(extension))
    return "archive";
  if (["doc", "docx", "rtf", "txt", "log"].includes(extension))
    return "document";
  return "file";
}
