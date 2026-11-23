import { describe, expect, it } from 'vitest'
import { parseHar } from './har'
import { maskCapture } from './maskCapture'
import { topology } from './topology'

function captureOf(hosts: string[]) {
  return parseHar(JSON.stringify({
    log: {
      version: '1.2',
      entries: hosts.map((host, index) => ({
        startedDateTime: '2026-01-01T12:00:00Z',
        time: index,
        request: { url: 'https://' + host + '/sensitive-route', method: index ? 'GET' : 'PRIVATECUSTOM' },
        response: { status: index ? 200 : 503, _transferSize: 100 },
        _resourceType: index ? 'fetch' : 'document',
      })),
    },
  }))
}

describe('maskCapture', () => {
  it('removes display identifiers without changing the analysis or the original capture', () => {
    const original = captureOf(['private.test', 'private.test', 'tracking.test'])
    const masked = maskCapture(original)
    expect(JSON.stringify(masked)).not.toMatch(/private\.test|tracking\.test|sensitive-route|PRIVATECUSTOM/)
    expect(masked.mainDomain).toBe('host-1.invalid')
    expect(masked.requests.map(({ domain, path, url, method, startedAt, status, duration, bytes, firstParty }) => ({
      domain, path, url, method, startedAt, status, duration, bytes, firstParty,
    }))).toEqual([
      { domain: 'host-1.invalid', path: '/request/1', url: 'host-1.invalid/request/1', method: null, startedAt: null, status: 503, duration: 0, bytes: 100, firstParty: true },
      { domain: 'host-1.invalid', path: '/request/2', url: 'host-1.invalid/request/2', method: 'GET', startedAt: null, status: 200, duration: 1, bytes: 100, firstParty: true },
      { domain: 'host-2.invalid', path: '/request/3', url: 'host-2.invalid/request/3', method: 'GET', startedAt: null, status: 200, duration: 2, bytes: 100, firstParty: false },
    ])
    expect(masked.slowest[0]).toBe(masked.requests[2])
    expect(masked).toMatchObject({ totalBytes: 300, errors: 1, thirdParty: 1, duration: 2 })
    expect(original.requests[0].url).toBe('https://private.test/sensitive-route')
    expect(original.requests[0].method).toBe('PRIVATECUSTOM')
  })

  it('preserves graph ordering, positions, counts, and grouped membership', () => {
    const original = captureOf(Array.from({ length: 26 }, (_, index) => 'origin-' + index + '.test'))
    const masked = maskCapture(original)
    const before = topology(original)
    const after = topology(masked)
    const shape = ({ nodes }: ReturnType<typeof topology>) => nodes.map(({ domain, position, root, grouped }) => ({
      count: domain.requests, position, root, grouped,
    }))
    expect(shape(after)).toEqual(shape(before))
    expect(after.hidden.size).toBe(4)
    expect(masked.requests.filter(({ domain }) => after.hidden.has(domain))).toHaveLength(4)
  })
})
