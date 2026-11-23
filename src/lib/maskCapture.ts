import type { Capture, Request } from './model'

const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'CONNECT', 'OPTIONS', 'TRACE', 'PATCH'])

export function hostAliases(...captures: (Capture | undefined)[]) {
  const hosts = new Map<string, string>()
  for (const capture of captures) {
    for (const { name } of capture?.domains ?? []) {
      if (!hosts.has(name)) hosts.set(name, 'host-' + (hosts.size + 1) + '.invalid')
    }
  }
  return hosts
}

/** A presentation copy for sharing the observatory with capture identifiers hidden. */
export function maskCapture(capture: Capture, hosts = hostAliases(capture)): Capture {
  const alias = (domain: string) => hosts.get(domain) ?? 'unknown-host.invalid'
  const requests: Request[] = capture.requests.map((request) => {
    const domain = alias(request.domain)
    const path = '/request/' + (request.id + 1)
    return {
      ...request,
      domain, path, url: domain + path,
      method: request.method !== null && methods.has(request.method) ? request.method : null,
      startedAt: null,
    }
  })
  const byId = new Map(requests.map((request) => [request.id, request]))
  return {
    ...capture,
    requests,
    domains: capture.domains.map((domain) => ({ ...domain, name: alias(domain.name) })),
    mainDomain: capture.mainDomain === null ? null : alias(capture.mainDomain),
    slowest: capture.slowest.flatMap(({ id }) => byId.get(id) ?? []),
  }
}
