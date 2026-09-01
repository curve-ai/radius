import type {
  SessionTranscriptEvent,
  SessionTranscriptStreamUpdate,
} from "../../../../radius-api";

export function sameSessionTranscriptSnapshot(
  current: readonly SessionTranscriptEvent[],
  next: readonly SessionTranscriptEvent[],
): boolean {
  return (
    current.length === next.length &&
    current.every((event, index) => {
      const nextEvent = next[index];
      if (
        event.eventId !== nextEvent?.eventId ||
        event.sessionRevision !== nextEvent.sessionRevision ||
        event.eventType !== nextEvent.eventType
      ) {
        return false;
      }
      if (event.eventType !== "message" || nextEvent.eventType !== "message") {
        return true;
      }
      const artifacts = event.artifacts ?? [];
      const nextArtifacts = nextEvent.artifacts ?? [];
      return (
        event.status === nextEvent.status &&
        event.text === nextEvent.text &&
        artifacts.length === nextArtifacts.length &&
        artifacts.every((artifact, artifactIndex) => {
          const nextArtifact = nextArtifacts[artifactIndex];
          return (
            artifact.id === nextArtifact?.id &&
            artifact.name === nextArtifact.name &&
            artifact.artifactType === nextArtifact.artifactType &&
            artifact.storageKind === nextArtifact.storageKind &&
            artifact.mimeType === nextArtifact.mimeType &&
            artifact.availability === nextArtifact.availability &&
            artifact.url === nextArtifact.url
          );
        })
      );
    })
  );
}

export function mergeSessionTranscriptStreamUpdate(
  current: SessionTranscriptEvent[],
  update: SessionTranscriptStreamUpdate,
): SessionTranscriptEvent[] {
  const eventIndex = current.findIndex(
    (event) => event.eventId === update.eventId,
  );
  if (update.event === null) {
    return eventIndex < 0
      ? current
      : current.filter((event) => event.eventId !== update.eventId);
  }
  if (update.mode === "append") {
    if (eventIndex < 0) {
      return update.textOffset === 0 ? [...current, update.event] : current;
    }
    const existing = current[eventIndex];
    if (
      existing?.eventType !== "message" ||
      existing.text.length !== update.textOffset
    ) {
      return current;
    }

    const next = [...current];
    next[eventIndex] = {
      ...update.event,
      text: existing.text + update.event.text,
    };
    return next;
  }
  if (eventIndex < 0) return [...current, update.event];

  const next = [...current];
  next[eventIndex] = update.event;
  return next;
}
