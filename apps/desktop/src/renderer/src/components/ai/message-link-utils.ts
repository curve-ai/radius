export function isMessageFileHref(href: string): boolean {
  if (/^https?:\/\//i.test(href)) return false;
  if (href.startsWith("#")) return false;
  return (
    href.startsWith("file:") ||
    href.startsWith("/") ||
    href.startsWith("./") ||
    href.startsWith("../") ||
    !/^[a-z][a-z\d+.-]*:/i.test(href)
  );
}
