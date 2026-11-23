import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseHar } from './har'
import { MAX_ENTRIES } from './limits'

const pack = (...entries: unknown[]) => JSON.stringify({ log: { version: '1.2', entries } })

function entry(url: string, options: Record<string, unknown> = {}) {
  return {
    startedDateTime: '2025-01-01T12:00:00.200Z',
    request: { url, method: 'GET' },
    response: { status: 200, headersSize: 120, bodySize: 880 },
    timings: { blocked: -1, dns: 3, connect: 10, ssl: 6, send: 1, wait: 70, receive: 5 },
    ...options,
  }
}

describe('parseHar', () => {
  it('parses the bundled synthetic HAR and aggregates its known totals', () => {
    const capture = parseHar(readFileSync(new URL('../../public/demo.har', import.meta.url), 'utf8'))
    expect(capture.requests).toHaveLength(128)
    expect(capture.domains).toHaveLength(9)
    expect(capture.mainDomain).toBe('nexus.test')
    expect(capture.errors).toBe(7)
    expect(capture.thirdParty).toBe(50)
    expect(capture.totalBytes).toBe(4_472_589)
    expect(capture.statuses.reduce((sum, status) => sum + status.count, 0)).toBe(128)
    expect(capture.slowest[0].duration).toBeGreaterThan(900)
  })

  it('handles invalid JSON, missing log, unsupported versions and entirely unusable captures', () => {
    expect(() => parseHar('{')).toThrow('invalid JSON')
    expect(() => parseHar('{"log": {}}')).toThrow('log.entries')
    expect(() => parseHar('{"log": {"version":"1.0","entries":[]}}')).toThrow('unsupported HAR version')
    expect(() => parseHar(pack(entry('javascript:alert(1)')))).toThrow('No usable')
    expect(parseHar('\uFEFF' + pack())).toMatchObject({ requests: [], domains: [], duration: null, totalBytes: null })
  })

  it('sorts by capture time and uses the first primary document for party classification', () => {
    const capture = parseHar(pack(
      entry('https://assets.example.co.uk/app.js', { startedDateTime: '2025-01-01T12:00:00.400Z' }),
      entry('https://metrics.other.test/', { startedDateTime: '2025-01-01T12:00:00.000Z' }),
      entry('https://example.co.uk/', { _resourceType: 'document' }),
    ))
    expect(capture.mainDomain).toBe('example.co.uk')
    expect(capture.requests.map(({ firstParty, offset }) => [firstParty, offset]))
      .toEqual([[false, 0], [true, 200], [true, 400]])
  })

  it('keeps tenants on a private suffix separate', () => {
    expect(parseHar(pack(
      entry('https://one.github.io/'),
      entry('https://two.github.io/'),
      entry('https://static.one.github.io/'),
    )).requests.map(({ firstParty }) => firstParty)).toEqual([true, false, true])
  })

  it('uses the first HTML response when the capture has no document extension', () => {
    const capture = parseHar(pack(
      entry('https://tracker.test/start', { startedDateTime: '2025-01-01T12:00:00.000Z' }),
      entry('https://app.test/', { response: { status: 200, content: { mimeType: 'text/html; charset=utf-8' } } }),
    ))
    expect(capture.mainDomain).toBe('app.test')
  })

  it('discards credentials, query values, fragments and capture headers and bodies', () => {
    const capture = parseHar(pack(entry('https://placeholder.test', {
      request: {
        url: 'https://loginUser:loginPass@safe.test/session/aKnownSecret/profile/person%40private.test?api_key=querySecret#hashSecret',
        method: 'GET', headers: [{ name: 'Authorization', value: 'headerSecret' }], postData: { text: 'bodySecret' },
      },
      response: { status: 200, headers: [{ name: 'Set-Cookie', value: 'cookieSecret' }] },
    })))
    expect(capture.requests[0].url).toBe('https://safe.test/session/[redacted]/profile/[redacted]?[redacted]')
    expect(JSON.stringify(capture)).not.toMatch(/loginUser|loginPass|KnownSecret|private\.test|querySecret|hashSecret|headerSecret|cookieSecret|bodySecret|api_key/)
  })

  it('masks common explicit secret segments and compact JWTs in URL paths', () => {
    const compactToken = ['{"alg":"HS256"}', '{}', 'synthetic']
      .map((part) => Buffer.from(part).toString('base64url')).join('.')
    const capture = parseHar(pack(entry(
      'https://safe.test/client%5Fsecret/shortsecret/x-api-key/mockkey/' +
      'csrf-token/mockcsrf/sessionToken/mocksession/verify/' + compactToken + '/index',
    )))
    expect(capture.requests[0].path).toBe(
      '/client%5Fsecret/[redacted]/x-api-key/[redacted]/csrf-token/[redacted]/sessionToken/[redacted]/verify/[redacted]/index',
    )
    expect(JSON.stringify(capture)).not.toMatch(/shortsecret|mockkey|mockcsrf|mocksession|eyJhbGci/)
  })

  it('uses safe integer byte counts and falls back when an extension field is invalid', () => {
    const capture = parseHar(pack(
      entry('https://safe.test/fallback', {
        response: { status: 200, _transferSize: 12.5, headersSize: 10, bodySize: 100 },
      }),
      entry('https://safe.test/overflow', {
        response: { status: 200, headersSize: Number.MAX_SAFE_INTEGER, bodySize: 1 },
      }),
      entry('https://safe.test/fractional', {
        response: { status: 200, headersSize: 10, bodySize: 0.5 },
      }),
    ))
    expect(capture.requests.map(({ bytes }) => bytes)).toEqual([110, null, null])
    expect(capture.totalBytes).toBe(110)
    expect(capture.measured).toBe(1)
  })

  it('distinguishes unavailable and zero values and honors the recorded transfer size', () => {
    const capture = parseHar(pack(
      entry('https://site.test/unknown', {
        request: { url: 'https://site.test/unknown' },
        response: { status: 0, headersSize: -1, bodySize: -1, content: { mimeType: 'application/json', size: 1400 } },
        startedDateTime: 'unknown', timings: { blocked: -1, dns: -1, connect: -1, send: -1, wait: -1, receive: -1 },
      }),
      entry('https://site.test/zero', { response: { status: 304, _transferSize: 0 }, time: 0 }),
      entry('https://site.test/measured', { response: { status: 500, _transferSize: 75, headersSize: 200, bodySize: 200 } }),
    ))
    expect(capture.requests[0]).toMatchObject({ bytes: 0, duration: 0, status: 304 })
    expect(capture.requests[1]).toMatchObject({ bytes: 75, duration: 89, status: 500 })
    expect(capture.requests[2]).toMatchObject({ bytes: null, duration: null, method: null, offset: null, status: null })
    expect(capture).toMatchObject({ totalBytes: 75, measured: 2, errors: 1, duration: 89 })
  })

  it('does not double-count TLS and does not guess incomplete HAR phase durations', () => {
    const capture = parseHar(pack(
      entry('https://site.test/complete'),
      entry('https://site.test/incomplete', { timings: { wait: 20 } }),
    ))
    expect(capture.requests[0].duration).toBe(89)
    expect(capture.requests[0].timing.ssl).toBe(6)
    expect(capture.requests[1].duration).toBeNull()
  })

  it('skips malformed entries and handles WebSocket hosts without making requests', () => {
    const capture = parseHar(pack(null, 'bad', entry('file:///path'), entry('wss://localhost:3030/socket')))
    expect(capture.skipped).toBe(3)
    expect(capture.mainDomain).toBe('localhost')
    expect(capture.requests[0].url).toBe('wss://localhost:3030/socket')
  })

  it('explicitly records entries omitted by the capture limit', () => {
    const raw = pack(...Array.from({ length: MAX_ENTRIES + 2 }, () => ({ request: { url: 'https://site.test/' } })))
    expect(parseHar(raw)).toMatchObject({ limited: 2, skipped: 0, domains: [{ requests: MAX_ENTRIES }] })
  })
})
