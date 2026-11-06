import {
  appendSessionEvent,
  updateSessionTitle,
  getSessionRevision,
  setSessionAccessModeAndDefault,
  type AppendEventOptions,
  type RadiusDatabase,
} from "@curve-ai/radius-storage";

const sessionWrites = new Map<string, Promise<unknown>>();
function withSessionWrite<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const pending = (sessionWrites.get(sessionId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(operation);
  sessionWrites.set(sessionId, pending);
  void pending
    .finally(() => {
      if (sessionWrites.get(sessionId) === pending)
        sessionWrites.delete(sessionId);
    })
    .catch(() => undefined);
  return pending;
}
export async function updateSessionAccessModeForDesktop(
  database: RadiusDatabase,
  clientInstanceId: string,
  sessionId: string | null,
  accessMode: "ask" | "project" | "full",
): Promise<void> {
  const write = async (): Promise<void> => {
    await setSessionAccessModeAndDefault(database, {
      clientInstanceId,
      sessionId,
      accessMode,
    });
  };
  if (sessionId) await withSessionWrite(sessionId, write);
  else await write();
}

export type RuntimeSessionEvent = Parameters<typeof appendSessionEvent>[1];
type RuntimeSessionEventBody = RuntimeSessionEvent extends infer Event
  ? Event extends RuntimeSessionEvent
    ? Omit<
        Event,
        | "sessionId"
        | "sessionRevision"
        | "sourceClientInstanceId"
        | "occurredAt"
        | "artifactLinks"
      >
    : never
  : never;

export class RuntimeSessionJournal {
  private revision: number;

  constructor(
    private readonly database: RadiusDatabase,
    private readonly sourceClientInstanceId: string,
    private readonly sessionId: string,
    initialRevision: number,
  ) {
    this.revision = initialRevision;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    return withSessionWrite(this.sessionId, operation);
  }

  append(
    event: RuntimeSessionEventBody,
    options: AppendEventOptions & {
      artifactLinks?: RuntimeSessionEvent["artifactLinks"];
    } = {},
  ): Promise<void> {
    return this.enqueue(async () => {
      this.revision =
        (await getSessionRevision(this.database, this.sessionId)) ??
        this.revision;
      const nextRevision = this.revision + 1;
      await appendSessionEvent(
        this.database,
        {
          ...event,
          sessionId: this.sessionId,
          sessionRevision: nextRevision,
          sourceClientInstanceId: this.sourceClientInstanceId,
          occurredAt: new Date().toISOString(),
          artifactLinks: options.artifactLinks ?? [],
        } as unknown as RuntimeSessionEvent,
        options,
      );
      this.revision = nextRevision;
    });
  }

  updateTitle(title: string): Promise<void> {
    return this.enqueue(async () => {
      const session = await updateSessionTitle(this.database, {
        sessionId: this.sessionId,
        originClientInstanceId: this.sourceClientInstanceId,
        title,
      });
      this.revision = session.revision;
    });
  }
}
