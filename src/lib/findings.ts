import { endpoint } from './compare'
import type { Capture } from './model'

export type Finding = {
  id: string
  title: string
  explanation: string
  ids: number[]
}

export function analyzeFindings(capture: Capture): Finding[] {
  const repeats = new Map<string, number[]>()
  const wait: number[] = []
  const large: number[] = []
  const thirdPartyErrors: number[] = []
  for (const request of capture.requests) {
    const key = endpoint(request)
    const matches = repeats.get(key)
    if (matches) matches.push(request.id)
    else repeats.set(key, [request.id])
    if (request.timing.wait !== null && request.timing.wait >= 500) wait.push(request.id)
    if (request.bytes !== null && request.bytes >= 512 * 1024) large.push(request.id)
    if (!request.firstParty && request.status !== null && request.status >= 400) thirdPartyErrors.push(request.id)
  }
  const repeated = [...repeats.values()].filter((ids) => ids.length >= 3)
  return [
    { id: 'third-party-errors', title: 'Third-party HTTP errors', explanation: 'Third-party responses with HTTP status 400 or higher.', ids: thirdPartyErrors },
    { id: 'response-wait', title: 'Long response wait', explanation: 'Recorded wait for the first response byte was at least 500 ms. This includes network time.', ids: wait },
    { id: 'large-transfers', title: 'Large transfers', explanation: 'Recorded transfer size was at least 512 KiB per request.', ids: large },
    { id: 'repeated-endpoints', title: 'Repeated endpoint calls', explanation: repeated.length + ' endpoint groups appeared at least three times. Matching uses method and redacted URL path, ignoring queries.', ids: repeated.flat() },
  ].filter(({ ids }) => ids.length > 0)
}
