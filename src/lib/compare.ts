import type { Capture, Request } from './model'

export type GroupBy = 'endpoint' | 'host'
export type CaptureSide = 'baseline' | 'candidate'
export type Metrics = {
  calls: number
  bytes: number | null
  byteSamples: number
  median: number | null
  p95: number | null
  timingSamples: number
  errors: number | null
  statusSamples: number
}
export type Metric = 'calls' | 'bytes' | 'median' | 'p95' | 'errors'
export type Comparison = {
  index: number
  label: string
  host: string
  ids: Record<CaptureSide, number[]>
  baseline: Metrics
  candidate: Metrics
}

export function endpoint(request: Request) {
  const address = request.url.replace(/\?\[redacted\]$/, '')
  return (request.method ?? '—') + ' ' + address
}

export function measure(requests: readonly Request[]): Metrics {
  let bytes = 0
  let byteSamples = 0
  let errors = 0
  let statusSamples = 0
  const times: number[] = []
  for (const request of requests) {
    if (request.bytes !== null) {
      bytes += request.bytes
      byteSamples += 1
    }
    if (request.status !== null) {
      statusSamples += 1
      if (request.status >= 400) errors += 1
    }
    if (request.duration !== null) times.push(request.duration)
  }
  times.sort((a, b) => a - b)
  const middle = Math.floor(times.length / 2)
  const median = !times.length ? null : times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2
  return {
    calls: requests.length,
    bytes: byteSamples ? bytes : requests.length ? null : 0,
    byteSamples,
    median,
    p95: times[Math.ceil(times.length * 0.95) - 1] ?? null,
    timingSamples: times.length,
    errors: statusSamples ? errors : requests.length ? null : 0,
    statusSamples,
  }
}

export function compareCaptures(baseline: Capture, candidate: Capture, groupBy: GroupBy): Comparison[] {
  const groups = new Map<string, { host: string; baseline: Request[]; candidate: Request[] }>()
  function group(capture: Capture, side: CaptureSide) {
    for (const request of capture.requests) {
      const key = groupBy === 'host' ? request.domain : endpoint(request)
      let item = groups.get(key)
      if (!item) {
        item = { host: request.domain, baseline: [], candidate: [] }
        groups.set(key, item)
      }
      item[side].push(request)
    }
  }
  group(baseline, 'baseline')
  group(candidate, 'candidate')
  return [...groups].map(([label, { host, baseline, candidate }], index) => ({
    index, label, host,
    ids: { baseline: baseline.map(({ id }) => id), candidate: candidate.map(({ id }) => id) },
    baseline: measure(baseline),
    candidate: measure(candidate),
  }))
}

export function metricCoverage(metrics: Metrics, metric: Metric) {
  if (metric === 'bytes') return metrics.byteSamples
  if (metric === 'errors') return metrics.statusSamples
  if (metric === 'calls') return metrics.calls
  return metrics.timingSamples
}

export function delta({ baseline, candidate }: Pick<Comparison, 'baseline' | 'candidate'>, metric: Metric) {
  const before = baseline[metric]
  const after = candidate[metric]
  if (before === null || after === null ||
      metricCoverage(baseline, metric) !== baseline.calls || metricCoverage(candidate, metric) !== candidate.calls) return null
  return after - before
}
