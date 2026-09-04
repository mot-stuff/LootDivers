/**
 * Read-only projection of authoritative state for an outer presentation.
 *
 * The source deliberately exposes no update method. Adapters may subscribe and
 * render snapshots, but state changes must enter the application as intents.
 */
export interface ReadModelSource<TReadModel> {
  getSnapshot(): Readonly<TReadModel>;
  subscribe(listener: (model: Readonly<TReadModel>) => void): () => void;
}

/**
 * Write-only application boundary for requested actions from a presentation.
 */
export interface IntentSink<TIntent> {
  emit(intent: Readonly<TIntent>): void;
}
