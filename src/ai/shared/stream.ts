export type AsyncIterableLike<T> = AsyncIterable<T> | AsyncIterator<T>;

export function isAsyncIterable<T = unknown>(value: unknown): value is AsyncIterable<T> {
  return !!value && typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function';
}

export function wrapAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  options: {
    onChunk?: (chunk: T) => void | Promise<void>;
    onReturn?: () => void | Promise<void>;
    onError?: (error: unknown) => void | Promise<void>;
  }
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = iterable[Symbol.asyncIterator]();

      return {
        async next() {
          try {
            const result = await iterator.next();

            if (result.done) {
              await options.onReturn?.();
              return result;
            }

            await options.onChunk?.(result.value);
            return result;
          } catch (error) {
            await options.onError?.(error);
            throw error;
          }
        },

        async return(value?: unknown) {
          try {
            if (typeof iterator.return === 'function') {
              return await iterator.return(value as never);
            }

            return { done: true, value } as IteratorResult<T>;
          } finally {
            await options.onReturn?.();
          }
        },

        async throw(error?: unknown) {
          try {
            if (typeof iterator.throw === 'function') {
              return await iterator.throw(error);
            }

            throw error;
          } catch (thrown) {
            await options.onError?.(thrown);
            throw thrown;
          }
        },
      };
    },
  };
}
