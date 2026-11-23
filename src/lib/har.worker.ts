import { parseHar } from './har'
import { MAX_HAR_BYTES } from './limits'
import type { Capture } from './model'

export type ParseResponse = { capture: Capture; parseMs: number } | { error: string }

self.onmessage = async ({ data }: MessageEvent<Blob | ArrayBuffer>) => {
  try {
    if ((data instanceof ArrayBuffer ? data.byteLength : data.size) > MAX_HAR_BYTES) throw new Error('This capture exceeds the 40 MiB file limit.')
    const text = data instanceof ArrayBuffer ? new TextDecoder().decode(data) : await data.text()
    const start = performance.now()
    const capture = parseHar(text)
    self.postMessage({ capture, parseMs: performance.now() - start } satisfies ParseResponse)
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'The capture could not be opened.' } satisfies ParseResponse)
  }
}
