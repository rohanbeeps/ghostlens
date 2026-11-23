import type { Capture, Domain } from './model'

export const GRAPH_DOMAIN_LIMIT = 22
// A URL hostname cannot contain a fragment delimiter.
export const OTHER_DOMAINS = '#other-domains'
export const GROUPED_COLOR = '#a7b3d5'

export type GraphNode = {
  domain: Domain
  position: [number, number, number]
  root: boolean
  grouped: boolean
}

export function topology(capture: Capture) {
  const root = capture.domains.find((domain) => domain.name === capture.mainDomain) ?? capture.domains[0]
  if (!root) return { nodes: [], hidden: new Set<string>() }
  const satellites = capture.domains.filter((domain) => domain !== root)
  const shown = satellites.slice(0, GRAPH_DOMAIN_LIMIT - 1)
  const overflow = satellites.slice(shown.length)
  if (overflow.length) {
    shown.push(overflow.reduce<Domain>((sum, domain) => ({
      ...sum, requests: sum.requests + domain.requests, bytes: sum.bytes + domain.bytes,
      measured: sum.measured + domain.measured, errors: sum.errors + domain.errors,
    }), { name: OTHER_DOMAINS, requests: 0, bytes: 0, measured: 0, errors: 0, firstParty: false }))
  }
  const nodes: GraphNode[] = [{ domain: root, position: [0, 0.08, 0], root: true, grouped: false }]
  shown.forEach((domain, index) => {
    const angle = index * Math.PI * 2 / shown.length + 0.7
    const radius = (shown.length <= 3 ? 3.25 : 4.15) + (index % 3) * 0.19
    const height = Math.sin(index * 2.19 + 0.8) * 0.46 - 0.12
    nodes.push({
      domain,
      position: [Math.cos(angle) * radius * 1.29, height, Math.sin(angle) * radius],
      root: false,
      grouped: domain.name === OTHER_DOMAINS,
    })
  })
  return { nodes, hidden: new Set(overflow.map((domain) => domain.name)) }
}

export function nodeRadius(node: GraphNode, metric: 'requests' | 'bytes', maximum: number) {
  const scale = Math.sqrt(Math.min(1.32, node.domain[metric] / Math.max(1, maximum)))
  return node.root ? 0.58 + scale * 0.25 : 0.17 + scale * 0.40
}
