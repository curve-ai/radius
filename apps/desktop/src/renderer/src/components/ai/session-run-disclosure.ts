export function resolveSessionRunDisclosure(
  live: boolean,
  userChoice: boolean | null,
): boolean {
  return userChoice ?? live;
}

export function toggleSessionRunDisclosure(expanded: boolean): boolean {
  return !expanded;
}
