/**
 * A minimal async queue implementing AsyncIterable<T>.
 *
 * Used to feed user messages into the Agent SDK's `query({ prompt })`. The SDK
 * accepts `AsyncIterable<SDKUserMessage>` for streaming input mode; push()
 * delivers messages synchronously when a consumer is waiting, otherwise
 * buffers them. close() ends the iteration.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private waiters: Array<(v: IteratorResult<T, undefined>) => void> = []
  private closed = false

  get isClosed(): boolean {
    return this.closed
  }

  get pendingCount(): number {
    return this.values.length
  }

  push(value: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value, done: false })
    } else {
      this.values.push(value)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length) {
      const w = this.waiters.shift()!
      w({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T, undefined> {
    const self = this
    return {
      next(): Promise<IteratorResult<T, undefined>> {
        const v = self.values.shift()
        if (v !== undefined) {
          return Promise.resolve({ value: v, done: false })
        }
        if (self.closed) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise((resolve) => self.waiters.push(resolve))
      },
      return(): Promise<IteratorResult<T, undefined>> {
        self.close()
        return Promise.resolve({ value: undefined, done: true })
      },
    }
  }
}
