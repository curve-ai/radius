import {
  appendSessionEvent,
  updateSessionTitle,
  type AppendEventOptions,
  type RadiusDatabase,
} from "@curve-ai/radius-storage";

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
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly database: RadiusDatabase,
    private readonly sourceClientInstanceId: string,
    private readonly sessionId: string,
    initialRevision: number,
  ) {
    this.revision = initialRevision;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const pending = this.tail.catch(() => undefined).then(operation);
    this.tail = pending.catch(() => undefined);
    return pending;
  }

  append(
    event: RuntimeSessionEventBody,
    options: AppendEventOptions & {
      artifactLinks?: RuntimeSessionEvent["artifactLinks"];
    } = {},
  ): Promise<void> {
    return this.enqueue(async () => {
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
