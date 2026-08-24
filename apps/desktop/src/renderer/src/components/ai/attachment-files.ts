const attachmentKeys = new WeakMap<File, string>();

export function attachmentFileKey(file: File): string {
  const existingKey = attachmentKeys.get(file);
  if (existingKey) return existingKey;

  const key = `attachment-${crypto.randomUUID()}`;
  attachmentKeys.set(file, key);
  return key;
}

export function appendAttachmentFiles(
  current: File[],
  incoming: readonly File[],
): File[] {
  if (incoming.length === 0) return current;

  const seen = new Set(current);
  const additions = incoming.filter((file) => {
    if (seen.has(file)) return false;
    seen.add(file);
    return true;
  });
  return additions.length > 0 ? [...current, ...additions] : current;
}
