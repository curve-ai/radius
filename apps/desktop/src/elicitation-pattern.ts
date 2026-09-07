const MAX_PATTERN_LENGTH = 512;
const MAX_PATTERN_INPUT_LENGTH = 4_096;

export function compileElicitationPattern(pattern: string): RegExp {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error("ELICITATION_PATTERN_UNSUPPORTED");
  }

  let escaped = false;
  let inCharacterClass = false;
  for (const character of pattern) {
    if (escaped) {
      if (!inCharacterClass && /[1-9]/.test(character)) {
        throw new Error("ELICITATION_PATTERN_UNSUPPORTED");
      }
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (character === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (!inCharacterClass && (character === "(" || character === ")")) {
      throw new Error("ELICITATION_PATTERN_UNSUPPORTED");
    }
  }
  if (escaped || inCharacterClass) {
    throw new Error("ELICITATION_PATTERN_UNSUPPORTED");
  }

  try {
    return new RegExp(pattern);
  } catch {
    throw new Error("ELICITATION_PATTERN_UNSUPPORTED");
  }
}

export function matchesElicitationPattern(
  pattern: string,
  value: string,
): boolean {
  if (value.length > MAX_PATTERN_INPUT_LENGTH) return false;
  return compileElicitationPattern(pattern).test(value);
}
