import { measure } from './compare'
import { analyzeFindings } from './findings'
import { count, size, time } from './format'
import type { Capture } from './model'

export function maskedReport(capture: Capture): string {
  const totals = measure(capture.requests)
  const coverage = (known: number) => count(known) + '/' + count(totals.calls) + ' measured'
  const hosts = capture.domains.slice(0, 10).map((host, index) =>
    '| Host ' + (index + 1) + ' | ' + (host.firstParty ? 'First party' : 'Third party') + ' | ' +
    count(host.requests) + ' | ' + size(host.measured ? host.bytes : null) + ' (' + count(host.measured) + '/' + count(host.requests) + ') |')
  const findings = analyzeFindings(capture).map(({ title, ids, explanation }) =>
    '- **' + title + '** · ' + count(ids.length) + ' requests. ' + explanation)
  const errors = totals.errors === null ? '—' : count(totals.errors)
  return [
    '# GhostLens capture report',
    '',
    'Capture identifiers are masked. Traffic statistics remain visible.',
    '',
    '## Summary',
    '',
    '- Requests: ' + count(totals.calls),
    '- Third-party requests: ' + count(capture.thirdParty),
    '- HTTP errors: ' + errors + ' (' + coverage(totals.statusSamples) + ')',
    '- Recorded transfer: ' + size(totals.bytes) + ' (' + coverage(totals.byteSamples) + ')',
    '- Median request duration: ' + time(totals.median) + ' (' + coverage(totals.timingSamples) + ')',
    '- 95th percentile duration: ' + time(totals.p95),
    '- Skipped entries: ' + count(capture.skipped),
    '- Entries beyond the import limit: ' + count(capture.limited),
    '',
    '## Busiest hosts (masked)',
    '',
    '| Host | Party | Requests | Recorded transfer (coverage) |',
    '| --- | --- | ---: | ---: |',
    ...hosts,
    '',
    '## Findings',
    '',
    ...(findings.length ? findings : ['No findings met the thresholds.']),
    '',
  ].join('\n')
}
