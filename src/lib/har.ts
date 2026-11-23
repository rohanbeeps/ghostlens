import { getDomain } from 'tldts'
import { MAX_ENTRIES } from './limits'
import { phases, type Capture, type Domain, type Request, type Resource } from './model'

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const measurement = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null
const byteCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null

const explicitResources = new Set<Resource>([
  'document', 'script', 'stylesheet', 'image', 'font', 'fetch', 'xhr', 'media', 'websocket', 'other',
])
function resourceType(value: unknown, mime: unknown): Resource | null {
  if (typeof value === 'string' && explicitResources.has(value as Resource)) return value as Resource
  if (typeof mime !== 'string' || !mime.trim()) return null
  const type = mime.toLowerCase().split(';')[0].trim()
  if (type === 'text/html') return 'document'
  if (type === 'text/css') return 'stylesheet'
  if (type.includes('javascript') || type.includes('ecmascript')) return 'script'
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('font/') || type.includes('woff')) return 'font'
  if (/^(audio|video)\//.test(type)) return 'media'
  return 'other'
}

const sensitiveName = /^(?:(?:(?:access|refresh|id|auth|csrf|xsrf|session)[-_]?)?tokens?|(?:x[-_]?)?api[-_]?keys?|keys?|auth(?:orization)?|credentials?|passwords?|(?:client[-_]?)?secrets?|sessions?|session[-_]?ids?|bearer|signatures?|sso|oauth|otp)$/i
const looksSensitive = /[@=:;]|^[0-9a-f]{24,}$|^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$|^[\w-]{24,}(?:\.[\w-]+){0,2}$|^\d{7,}$/i
const compactJwt = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/

function safePath(path: string): string {
  let maskNext = false
  return path.slice(0, 4000).split('/').map((segment) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return segment ? '[redacted]' : ''
    }
    const mask = maskNext
    if (segment) maskNext = sensitiveName.test(decoded)
    return segment && (mask || looksSensitive.test(decoded) || compactJwt.test(decoded) || /[%\\/\u0000-\u001f\u007f]/.test(decoded) || decoded.length > 90)
      ? '[redacted]'
      : segment
  }).join('/').slice(0, 500)
}

function parseEntry(value: unknown, id: number): (Omit<Request, 'firstParty' | 'offset'> & { document: boolean }) | null {
  const entry = record(value)
  if (!entry) return null
  const request = record(entry.request)
  const response = record(entry.response)
  const timings = record(entry.timings)
  if (typeof request?.url !== 'string' || request.url.length > 25_000) return null
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return null
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return null
  const path = safePath(url.pathname)
  const reported = byteCount(response?._transferSize) ?? byteCount(entry._transferSize)
  const headers = byteCount(response?.headersSize)
  const body = byteCount(response?.bodySize)
  const status = measurement(response?.status)
  const timestamp = typeof entry.startedDateTime === 'string' ? Date.parse(entry.startedDateTime) : NaN
  const timing = {
    blocked: measurement(timings?.blocked), dns: measurement(timings?.dns),
    connect: measurement(timings?.connect), ssl: measurement(timings?.ssl),
    send: measurement(timings?.send), wait: measurement(timings?.wait), receive: measurement(timings?.receive),
  }
  const hasCompleteTiming = phases.some((phase) => timing[phase] !== null) &&
    phases.every((phase) => timing[phase] !== null || timings?.[phase] === -1)
  return {
    id, path, timing,
    url: url.origin + path + (url.search ? '?[redacted]' : ''),
    domain: url.hostname.replace(/\.$/, ''),
    duration: measurement(entry.time) ?? (hasCompleteTiming ? phases.reduce((sum, phase) => sum + (timing[phase] ?? 0), 0) : null),
    startedAt: Number.isFinite(timestamp) ? timestamp : null,
    bytes: reported ?? (headers !== null && body !== null ? byteCount(headers + body) : null),
    status: status !== null && Number.isInteger(status) && status >= 100 && status < 600 ? status : null,
    method: typeof request.method === 'string' && /^[A-Za-z]{1,20}$/.test(request.method) ? request.method.toUpperCase() : null,
    resource: resourceType(entry._resourceType, record(response?.content)?.mimeType),
    document: entry._resourceType === 'document',
  }
}

export function parseHar(input: string): Capture {
  let json: unknown
  try {
    json = JSON.parse(input.replace(/^\uFEFF/, '')) as unknown
  } catch {
    throw new Error('This file contains invalid JSON. Export a HAR file from your browser and try again.')
  }
  const log = record(record(json)?.log)
  if (!log || !Array.isArray(log.entries)) throw new Error('This file is missing the HAR log.entries array.')
  if (log.version !== undefined && log.version !== '1.2') throw new Error('This capture uses an unsupported HAR version. Export it as HAR 1.2.')
  const entries: unknown[] = log.entries
  const parsed = entries.slice(0, MAX_ENTRIES).map(parseEntry).filter((entry) => entry !== null)
  if (entries.length && !parsed.length) throw new Error('No usable HTTP or WebSocket requests were found in this capture.')
  parsed.sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity) || a.id - b.id)
  const start = parsed[0]?.startedAt ?? null
  const mainDomain = (parsed.find((request) => request.document) ??
    parsed.find((request) => request.resource === 'document') ?? parsed[0])?.domain ?? null
  const party = (hostname: string) => getDomain(hostname, { allowPrivateDomains: true }) ?? hostname
  const mainParty = mainDomain ? party(mainDomain) : null
  const aggregate = new Map<string, Domain>()
  const statuses = [
    { label: '1xx', count: 0, color: '#9cadd0' },
    { label: '2xx', count: 0, color: '#4bdcf8' },
    { label: '3xx', count: 0, color: '#a58bff' },
    { label: '4xx', count: 0, color: '#ffb578' },
    { label: '5xx', count: 0, color: '#fb809b' },
    { label: 'Unavailable', count: 0, color: '#657494' },
  ]
  let errors = 0
  let duration: number | null = null
  let totalBytes = 0
  let measured = 0
  let thirdParty = 0
  const requests = parsed.map(({ document: _document, ...request }): Request => {
    const offset = start !== null && request.startedAt !== null ? request.startedAt - start : null
    let domain = aggregate.get(request.domain)
    if (!domain) {
      domain = { name: request.domain, requests: 0, bytes: 0, measured: 0, errors: 0, firstParty: party(request.domain) === mainParty }
      aggregate.set(request.domain, domain)
    }
    domain.requests += 1
    if (request.bytes !== null) {
      domain.measured += 1
      domain.bytes += request.bytes
      measured += 1
      totalBytes += request.bytes
    }
    if (request.status !== null && request.status >= 400) {
      errors += 1
      domain.errors += 1
    }
    statuses[request.status === null ? 5 : Math.floor(request.status / 100) - 1].count += 1
    if (!domain.firstParty) thirdParty += 1
    if (offset !== null && request.duration !== null) duration = Math.max(duration ?? 0, offset + request.duration)
    return { ...request, offset, firstParty: domain.firstParty }
  })
  return {
    requests, mainDomain, statuses, errors, duration, thirdParty, measured,
    totalBytes: measured ? totalBytes : null,
    limited: Math.max(0, entries.length - MAX_ENTRIES),
    skipped: Math.min(entries.length, MAX_ENTRIES) - parsed.length,
    domains: [...aggregate.values()].sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name)),
    slowest: requests.filter((request) => request.duration !== null).sort((a, b) => b.duration! - a.duration!).slice(0, 5),
  }
}
