import type { ReadModelSource } from "../../core";

export interface ReadModelPublisher<TReadModel> {
  publish(model: Readonly<TReadModel>): void;
}

export interface ReadModelChannel<TReadModel> {
  readonly source: ReadModelSource<TReadModel>;
  readonly publisher: ReadModelPublisher<TReadModel>;
}

export function createReadModelChannel<TReadModel>(
  initialModel: Readonly<TReadModel>,
): ReadModelChannel<TReadModel> {
  let current = initialModel;
  const listeners = new Set<(model: Readonly<TReadModel>) => void>();

  return {
    source: {
      getSnapshot: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    publisher: {
      publish(model) {
        current = model;
        for (const listener of listeners) {
          listener(model);
        }
      },
    },
  };
}
