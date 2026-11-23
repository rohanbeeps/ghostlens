import { describe, expect, it } from 'vitest'
import { parseHar } from './har'
import { GRAPH_DOMAIN_LIMIT, nodeRadius, OTHER_DOMAINS, topology } from './topology'

function capture(hosts: string[]) {
  return parseHar(JSON.stringify({
    log: { version: '1.2', entries: hosts.map((host, index) => ({
      request: { url: 'https://' + host }, response: { _transferSize: index },
      _resourceType: index === 0 ? 'document' : 'image',
    })) },
  }))
}

describe('topology', () => {
  it('returns an empty topology when there are no domains', () => {
    expect(topology(capture([]))).toEqual({ nodes: [], hidden: new Set() })
  })

  it('keeps the primary host in the center even if it received fewer requests', () => {
    const data = capture(['primary.test', 'api.other.test', 'api.other.test'])
    const result = topology(data)
    expect(result.nodes[0]).toMatchObject({ domain: { name: 'primary.test' }, root: true })
    expect(result.nodes[1]?.position).not.toEqual(result.nodes[0]?.position)
    expect(topology(data)).toEqual(result)
  })

  it('groups overflow hostnames without losing their request counts or bytes', () => {
    const data = capture(Array.from({ length: 60 }, (_, index) => 'host-' + index + '.test'))
    const result = topology(data)
    expect(result.nodes).toHaveLength(GRAPH_DOMAIN_LIMIT + 1)
    expect(result.hidden.size).toBe(60 - GRAPH_DOMAIN_LIMIT)
    expect(result.nodes.at(-1)?.domain.name).toBe(OTHER_DOMAINS)
    expect(result.nodes.reduce((sum, { domain }) => sum + domain.requests, 0)).toBe(60)
    expect(result.nodes.reduce((sum, { domain }) => sum + domain.bytes, 0)).toBe(data.totalBytes)
  })

  it('keeps a hostname resembling the old group identifier selectable as an individual', () => {
    const name = '__ghostlens_other_domains__'
    const result = topology(capture(['root.test', name]))
    expect(result.nodes[1]).toMatchObject({ domain: { name }, grouped: false })
    expect(result.nodes[1]?.domain.name).not.toBe(OTHER_DOMAINS)
    expect(result.hidden.size).toBe(0)
  })

  it('starts grouping only after the distinct hostname limit and keeps each omitted member', () => {
    const hosts = Array.from({ length: GRAPH_DOMAIN_LIMIT }, (_, index) => 'host-' + String(index).padStart(2, '0') + '.test')
    const atLimit = topology(capture(hosts))
    expect(atLimit.nodes.every((node) => !node.grouped)).toBe(true)
    expect(atLimit.hidden.size).toBe(0)

    const aboveLimit = topology(capture([...hosts, 'z.test']))
    expect(aboveLimit.nodes.at(-1)).toMatchObject({ grouped: true, domain: { name: OTHER_DOMAINS, requests: 1 } })
    expect([...aboveLimit.hidden]).toEqual(['z.test'])
  })

  it('scales satellites by the chosen metric and bounds large grouped nodes', () => {
    const { nodes } = topology(capture(['root.test', 'a.test', 'z.test']))
    expect(nodeRadius(nodes[1], 'requests', 1)).toBe(nodeRadius(nodes[2], 'requests', 1))
    expect(nodeRadius(nodes[2], 'bytes', 2)).toBeGreaterThan(nodeRadius(nodes[1], 'bytes', 2))
    expect(nodeRadius(nodes[2], 'bytes', 0.01)).toBeLessThan(0.65)
  })
})
