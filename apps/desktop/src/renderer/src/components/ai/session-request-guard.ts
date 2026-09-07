export interface SessionRequestGuard {
  current(token: number): boolean;
  invalidate(): void;
  start(): number;
}

export function createSessionRequestGuard(): SessionRequestGuard {
  let generation = 0;
  return {
    current: (token) => token === generation,
    invalidate: () => {
      generation += 1;
    },
    start: () => {
      generation += 1;
      return generation;
    },
  };
}
