import { describe, expect, it } from 'vitest'
import { compareCaptures, delta, measure, metricCoverage } from './compare'
import { analyzeFindings } from './findings'
import { parseHar } from './har'
import { maskedReport } from './report'

function entry(url: string, { method = 'GET', time, status, bytes, wait }: {
  method?: string; time?: number; status?: number; bytes?: number; wait?: number
} = {}) {
  return { request: { url, method }, time, response: { status, _transferSize: bytes }, timings: { wait } }
}

const capture = (...entries: ReturnType<typeof entry>[]) => parseHar(JSON.stringify({ log: { entries } }))

describe('capture comparison', () => {
  it('groups by method, origin and redacted path while ignoring query values', () => {
    const baseline = capture(
      entry('https://shop.test/items?cursor=old', { time: 100, status: 200, bytes: 100 }),
      entry('https://shop.test/items?cursor=old', { method: 'POST', time: 500, status: 201 }),
      entry('https://shop.test/unloaded', { time: 800, status: 404, bytes: 40 }),
    )
    const candidate = capture(
      entry('https://shop.test/items?cursor=new', { time: 150, status: 503, bytes: 160 }),
      entry('https://shop.test:8443/items?cursor=new', { time: 80, status: 200, bytes: 50 }),
    )
    const [matched, post, removed, otherPort] = compareCaptures(baseline, candidate, 'endpoint')
    expect(matched.label).toBe('GET https://shop.test/items')
    expect(matched.ids).toEqual({ baseline: [0], candidate: [0] })
    expect(delta(matched, 'median')).toBe(50)
    expect(delta(matched, 'bytes')).toBe(60)
    expect(delta(matched, 'errors')).toBe(1)
    expect(delta(post, 'calls')).toBe(-1)
    expect(delta(removed, 'bytes')).toBe(-40)
    expect(delta(removed, 'median')).toBeNull()
    expect(otherPort.label).toBe('GET https://shop.test:8443/items')
    expect(delta(otherPort, 'bytes')).toBe(50)
    expect(compareCaptures(baseline, candidate, 'host')).toHaveLength(1)
  })

  it('calculates median and p95 and suppresses deltas with incomplete coverage', () => {
    const before = measure(capture(
      entry('https://app.test/', { time: 20, bytes: 80, status: 200 }),
      entry('https://app.test/', { time: 40, bytes: 0, status: 200 }),
    ).requests)
    const after = measure(capture(
      entry('https://app.test/', { time: 80, bytes: 90, status: 500 }),
      entry('https://app.test/'),
    ).requests)
    expect(before).toMatchObject({ bytes: 80, median: 30, p95: 40 })
    expect(after).toMatchObject({ bytes: 90, median: 80, p95: 80, errors: 1 })
    expect(metricCoverage(after, 'bytes')).toBe(1)
    for (const metric of ['median', 'p95', 'bytes', 'errors'] as const) {
      expect(delta({ baseline: before, candidate: after }, metric)).toBeNull()
    }
    expect(delta({ baseline: before, candidate: after }, 'calls')).toBe(0)
  })
})

describe('findings and masked reports', () => {
  const sample = capture(
    entry('https://main.test/unrecognized-path', { wait: 499, bytes: 0, status: 200 }),
    entry('https://cdn.test/resource?track=opaque-one', { wait: 500, bytes: 512 * 1024, status: 503 }),
    entry('https://cdn.test/resource?track=opaque-two', { wait: 100, bytes: 10, status: 200 }),
    entry('https://cdn.test/resource?track=opaque-three'),
    entry('https://cdn.test/resource', { method: 'CUSTOMLABEL', status: 200 }),
  )

  it('links each threshold finding to the exact request IDs', () => {
    expect(analyzeFindings(sample).map(({ id, ids }) => [id, ids])).toEqual([
      ['third-party-errors', [1]], ['response-wait', [1]], ['large-transfers', [1]], ['repeated-endpoints', [1, 2, 3]],
    ])
  })

  it('exports aggregate measurements and placeholder hosts without capture identifiers', () => {
    const report = maskedReport(sample)
    expect(report).toContain('| Host 1 | Third party | 4 |')
    expect(report).toContain('HTTP errors: 1 (4/5 measured)')
    expect(report).toContain('Long response wait')
    expect(report).not.toMatch(/main\.test|cdn\.test|resource|unrecognized-path|opaque-|CUSTOMLABEL/)
  })
})
