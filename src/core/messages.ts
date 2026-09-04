export interface CommandEnvelope<TType extends string, TPayload = undefined> {
  readonly type: TType;
  readonly sequence: number;
  readonly targetTick: number;
  readonly payload: Readonly<TPayload>;
}

export interface EventEnvelope<TType extends string, TPayload = undefined> {
  readonly type: TType;
  readonly tick: number;
  readonly sequence: number;
  readonly payload: Readonly<TPayload>;
}

/**
 * Converts a command payload map into a discriminated command union.
 */
export type CommandsFrom<
  TPayloads,
  TType extends keyof TPayloads & string = keyof TPayloads & string,
> = TType extends keyof TPayloads & string
  ? CommandEnvelope<TType, TPayloads[TType]>
  : never;

/**
 * Converts an event payload map into a discriminated event union.
 */
export type EventsFrom<
  TPayloads,
  TType extends keyof TPayloads & string = keyof TPayloads & string,
> = TType extends keyof TPayloads & string
  ? EventEnvelope<TType, TPayloads[TType]>
  : never;

export interface CommandSource<TCommand> {
  /**
   * Returns commands for one tick in stable sequence order.
   */
  takeForTick(tick: number): readonly TCommand[];
}

export interface EventSink<TEvent> {
  publish(event: TEvent): void;
}
