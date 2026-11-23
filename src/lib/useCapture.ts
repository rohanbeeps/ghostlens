import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_HAR_BYTES } from './limits'
import type { ParseResponse } from './har.worker'
import type { Capture } from './model'
import HarWorker from 'ghostlens-har-worker'
import embeddedDemo from 'virtual:embedded-demo'

type OpenCapture = { id: number; capture: Capture; name: string; demo: boolean }

async function parseInWorker(file: Blob, signal: AbortSignal): Promise<Capture> {
  // WebKit cannot reliably read a Blob sent to a worker from a file:// page.
  const input = embeddedDemo === null ? file : await file.arrayBuffer()
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const worker = new HarWorker()
    function cleanup() {
      worker.terminate()
      signal.removeEventListener('abort', onAbort)
    }
    function onAbort() {
      cleanup()
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<ParseResponse>) => {
      cleanup()
      if ('error' in data) reject(new Error(data.error))
      else resolve(data.capture)
    }
    worker.onerror = () => {
      cleanup()
      reject(new Error('The background parser could not start. Reload the app and try again.'))
    }
    if (input instanceof ArrayBuffer) worker.postMessage(input, [input])
    else worker.postMessage(input)
  })
}

export function useCapture(loadDemo = true) {
  const sequence = useRef(0)
  const active = useRef<AbortController | null>(null)
  const [data, setData] = useState<OpenCapture | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback(async (file?: File) => {
    active.current?.abort()
    const controller = new AbortController()
    const { signal } = controller
    active.current = controller
    setLoading(true)
    setError(null)
    try {
      let blob: Blob
      if (file) {
        if (!file.size) throw new Error('This file is empty. Choose a HAR capture with network entries.')
        if (file.size > MAX_HAR_BYTES) throw new Error('This capture exceeds 40 MiB. Export a shorter recording and try again.')
        blob = file
      } else if (embeddedDemo !== null) {
        blob = new Blob([embeddedDemo], { type: 'application/json' })
      } else {
        const demo = await fetch(import.meta.env.BASE_URL + 'demo.har', { signal })
        if (!demo.ok) throw new Error('The synthetic demo could not be loaded.')
        blob = await demo.blob()
      }
      const capture = await parseInWorker(blob, signal)
      if (!signal.aborted) setData({ id: ++sequence.current, capture, name: file?.name ?? 'nexus-demo.har', demo: !file })
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'The capture could not be opened.')
    } finally {
      if (!signal.aborted) {
        active.current = null
        setLoading(false)
      }
    }
  }, [])

  const clear = useCallback(() => {
    active.current?.abort()
    active.current = null
    setLoading(false)
    setError(null)
    setData(null)
  }, [])

  useEffect(() => {
    if (loadDemo) void open()
    return () => active.current?.abort()
  }, [loadDemo, open])

  return { data, loading, error, open, clear, dismissError: () => setError(null) }
}
