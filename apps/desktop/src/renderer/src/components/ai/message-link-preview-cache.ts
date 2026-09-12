import { MarkdownLinkPreviewCache } from "../../../../shared/markdown-link-preview-cache";

export const messageLinkPreviewCache = new MarkdownLinkPreviewCache((href) =>
  window.radius.resolveMarkdownLinkPreview(href),
);
