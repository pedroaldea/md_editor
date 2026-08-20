type PromiseCompatConstructor = PromiseConstructor & {
  try?: (
    callback: (...args: unknown[]) => unknown,
    ...args: unknown[]
  ) => Promise<unknown>;
  withResolvers?: () => {
    promise: Promise<unknown>;
    resolve: (value: unknown | PromiseLike<unknown>) => void;
    reject: (reason?: unknown) => void;
  };
};

type AsyncIterableStream<T> = ReadableStream<T> & AsyncIterable<T>;

/**
 * PDF.js 6 targets newer browser runtimes than the WebKit version bundled by
 * some supported macOS releases. Install only the missing standards APIs.
 */
export const installPdfRuntimeCompatibility = (): void => {
  const constructor = Promise as PromiseCompatConstructor;

  if (typeof constructor.withResolvers !== "function") {
    constructor.withResolvers = () => {
      let resolve!: (value: unknown | PromiseLike<unknown>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<unknown>((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
      });
      return { promise, resolve, reject };
    };
  }

  if (typeof constructor.try !== "function") {
    constructor.try = (callback, ...args) =>
      new Promise<unknown>((resolve) => resolve(callback(...args)));
  }

  if (
    typeof ReadableStream !== "undefined" &&
    typeof (ReadableStream.prototype as Partial<AsyncIterableStream<unknown>>)[Symbol.asyncIterator] !== "function"
  ) {
    Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
      configurable: true,
      writable: true,
      value: async function* <T>(this: ReadableStream<T>): AsyncGenerator<T, void, unknown> {
        const reader = this.getReader();
        try {
          while (true) {
            const result = await reader.read();
            if (result.done) return;
            yield result.value;
          }
        } finally {
          reader.releaseLock();
        }
      }
    });
  }
};
