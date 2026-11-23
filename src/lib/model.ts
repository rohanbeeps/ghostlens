export const phases = ['blocked', 'dns', 'connect', 'send', 'wait', 'receive'] as const
export type Phase = (typeof phases)[number]
export type Timing = Record<Phase | 'ssl', number | null>
export type Resource = 'document' | 'script' | 'stylesheet' | 'image' | 'font' | 'fetch' | 'xhr' | 'media' | 'websocket' | 'other'
export type Request = {
  id: number
  url: string
  path: string
  domain: string
  method: string | null
  status: number | null
  duration: number | null
  bytes: number | null
  startedAt: number | null
  offset: number | null
  resource: Resource | null
  timing: Timing
  firstParty: boolean
}
export type Domain = {
  name: string
  requests: number
  bytes: number
  measured: number
  errors: number
  firstParty: boolean
}
export type Capture = {
  requests: Request[]
  domains: Domain[]
  mainDomain: string | null
  totalBytes: number | null
  measured: number
  errors: number
  thirdParty: number
  duration: number | null
  skipped: number
  limited: number
  statuses: { label: string; count: number; color: string }[]
  slowest: Request[]
}
export const phaseColor: Record<Phase | 'ssl', string> = {
  blocked: '#63789d', dns: '#b294f6', connect: '#8674fa', ssl: '#6553c9',
  send: '#f1bc77', wait: '#49daf8', receive: '#7191fb',
}
export const phaseLabel: Record<Phase | 'ssl', string> = {
  blocked: 'Queued', dns: 'DNS lookup', connect: 'Connect', ssl: 'TLS (within connect)',
  send: 'Send', wait: 'Wait / TTFB', receive: 'Receive',
}
