// Draft text, files and preferences share one local writer across renderers.
let tail: Promise<unknown> = Promise.resolve();
export function withComposerMutation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const pending = tail.catch(() => undefined).then(operation);
  tail = pending.catch(() => undefined);
  return pending;
}
