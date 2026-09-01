export type GeneratedImageLinkSegment =
  | { kind: "text"; text: string }
  | { kind: "image"; alt: string; raw: string; uri: string };

const GENERATED_IMAGE_LINK =
  /\[▧\s*([^\]]+)\]\((sandbox:[^)\s]+|https:\/\/[^)\s]+)\)/g;

export function splitGeneratedImageLinks(
  text: string,
): GeneratedImageLinkSegment[] {
  const segments: GeneratedImageLinkSegment[] = [];
  let offset = 0;
  for (const match of text.matchAll(GENERATED_IMAGE_LINK)) {
    const index = match.index;
    if (index > offset) {
      segments.push({ kind: "text", text: text.slice(offset, index) });
    }
    segments.push({
      kind: "image",
      alt: (match[1] ?? "Generated image").trim(),
      raw: match[0],
      uri: match[2] ?? "",
    });
    offset = index + match[0].length;
  }
  if (offset < text.length) {
    segments.push({ kind: "text", text: text.slice(offset) });
  }
  return segments.length > 0 ? segments : [{ kind: "text", text }];
}
