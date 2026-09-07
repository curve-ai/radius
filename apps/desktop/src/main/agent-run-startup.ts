export interface AgentRunStartup {
  promise: Promise<void>;
  reject(cause: unknown): void;
  resolve(): void;
}

export function createAgentRunStartup(): AgentRunStartup {
  let rejectPromise!: (cause: unknown) => void;
  let resolvePromise!: () => void;
  let settled = false;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    reject: (cause) => {
      if (settled) return;
      settled = true;
      rejectPromise(cause);
    },
    resolve: () => {
      if (settled) return;
      settled = true;
      resolvePromise();
    },
  };
}
