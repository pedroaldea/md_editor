import { afterEach, describe, expect, it } from "vitest";
import { installPdfRuntimeCompatibility } from "../../src/lib/pdfRuntimeCompatibility";

type PromiseCompatConstructor = PromiseConstructor & {
  try?: (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown>;
  withResolvers?: () => {
    promise: Promise<unknown>;
    resolve: (value: unknown | PromiseLike<unknown>) => void;
    reject: (reason?: unknown) => void;
  };
};

const constructor = Promise as PromiseCompatConstructor;
const originalTry = constructor.try;
const originalWithResolvers = constructor.withResolvers;

afterEach(() => {
  constructor.try = originalTry;
  constructor.withResolvers = originalWithResolvers;
});

describe("installPdfRuntimeCompatibility", () => {
  it("fills the Promise APIs required by PDF.js on macOS WebKit", async () => {
    constructor.try = undefined;
    constructor.withResolvers = undefined;
    installPdfRuntimeCompatibility();

    const promiseTry = constructor.try as unknown as NonNullable<PromiseCompatConstructor["try"]>;
    const withResolvers = constructor.withResolvers as unknown as NonNullable<PromiseCompatConstructor["withResolvers"]>;
    await expect(promiseTry((left: unknown, right: unknown) => Number(left) + Number(right), 2, 3))
      .resolves.toBe(5);
    const capability = withResolvers();
    capability.resolve("ready");
    await expect(capability.promise).resolves.toBe("ready");
  });

  it("turns synchronous Promise.try failures into rejections", async () => {
    constructor.try = undefined;
    installPdfRuntimeCompatibility();

    const promiseTry = constructor.try as unknown as NonNullable<PromiseCompatConstructor["try"]>;
    await expect(promiseTry(() => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
  });

  it("makes ReadableStream async iterable for PDF.js getTextContent", async () => {
    const prototype = ReadableStream.prototype as ReadableStream<unknown> & {
      [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
    };
    const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, Symbol.asyncIterator);
    Object.defineProperty(prototype, Symbol.asyncIterator, {
      configurable: true,
      writable: true,
      value: undefined
    });

    try {
      installPdfRuntimeCompatibility();
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue("first");
          controller.enqueue("second");
          controller.close();
        }
      });
      const values: string[] = [];
      for await (const value of stream as ReadableStream<string> & AsyncIterable<string>) {
        values.push(value);
      }
      expect(values).toEqual(["first", "second"]);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(prototype, Symbol.asyncIterator, originalDescriptor);
      } else {
        delete prototype[Symbol.asyncIterator];
      }
    }
  });
});
