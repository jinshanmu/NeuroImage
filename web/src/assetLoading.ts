/** Read ahead without reordering GPU updates or retaining an entire atlas in memory. */
export async function loadAssetsInOrder<T>(
  items: readonly T[], url: (item: T) => string,
  consume: (item: T, buffer: ArrayBuffer) => Promise<void> | void,
  signal: AbortSignal, current: () => boolean = () => true,
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  type Result = { buffer: ArrayBuffer; error?: never } | { error: unknown; buffer?: never }
  const pending: Promise<Result>[] = []
  let next = 0
  const fill = () => {
    while (!controller.signal.aborted && current() && pending.length < 4 && next < items.length) {
      const path = url(items[next++])
      // Handle failures immediately, even if an earlier asset is still being decoded.
      pending.push(fetch(path, { signal: controller.signal }).then(async response => {
        if (!response.ok) throw Error(`Could not load source asset (${response.status}): ${path}`)
        return { buffer: await response.arrayBuffer() }
      }).catch(error => ({ error })))
    }
  }
  try {
    fill()
    for (const item of items) {
      if (controller.signal.aborted || !current()) return
      const result = await pending.shift()!
      if (controller.signal.aborted || !current()) return
      if ('error' in result) throw result.error
      fill()
      await consume(item, result.buffer)
    }
  } finally {
    controller.abort()
    signal.removeEventListener('abort', abort)
  }
}
