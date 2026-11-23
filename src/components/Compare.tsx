import { useDeferredValue, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, GitCompareArrows, Upload } from 'lucide-react'
import { compareCaptures, delta, measure, metricCoverage, type CaptureSide, type Comparison, type GroupBy, type Metric, type Metrics } from '../lib/compare'
import { count, size, time } from '../lib/format'
import type { Capture } from '../lib/model'

type Slot = { name: string; capture: Capture } | null
const sides: CaptureSide[] = ['baseline', 'candidate']
const metrics: { key: Metric; label: string; format: (value: number) => string }[] = [
  { key: 'calls', label: 'Requests', format: count },
  { key: 'bytes', label: 'Transferred', format: size },
  { key: 'median', label: 'Median', format: time },
  { key: 'p95', label: 'p95', format: time },
  { key: 'errors', label: 'HTTP errors', format: count },
]
const pageSize = 20

function MetricChange({ row, metric }: { row: Pick<Comparison, 'baseline' | 'candidate'>; metric: typeof metrics[number] }) {
  const { key, format } = metric
  const change = delta(row, key)
  function describe(snapshot: Metrics) {
    const value = snapshot[key]
    return value === null ? '—' : format(value)
  }
  return <div className="comparison-metric">
    <strong className={change === null || !change ? undefined : change > 0 ? 'increase' : 'decrease'}>
      {change === null ? '—' : (change > 0 ? '+' : change < 0 ? '−' : '') + format(Math.abs(change))}
    </strong>
    <small>{describe(row.baseline)} → {describe(row.candidate)}</small>
    {key !== 'calls' && <small>{metricCoverage(row.baseline, key)}/{row.baseline.calls} → {metricCoverage(row.candidate, key)}/{row.candidate.calls} measured</small>}
  </div>
}

export function Compare({ slots, aliases, onImport, onView, onInspect, onClearCandidate }: {
  slots: Record<CaptureSide, Slot>
  aliases: Map<string, string> | null
  onImport: (side: CaptureSide) => void
  onView: (side: CaptureSide) => void
  onInspect: (side: CaptureSide, ids: number[]) => void
  onClearCandidate: () => void
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>('endpoint')
  const [sort, setSort] = useState<Metric>('bytes')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const baseline = slots.baseline?.capture
  const candidate = slots.candidate?.capture
  const rows = useMemo(() => baseline && candidate ? compareCaptures(baseline, candidate, groupBy) : [], [baseline, candidate, groupBy])
  const totals = useMemo(() => baseline && candidate ? { baseline: measure(baseline.requests), candidate: measure(candidate.requests) } : null, [baseline, candidate])
  const query = useDeferredValue(search.toLowerCase().trim())
  const sorted = useMemo(() => rows.map((row) => {
    const change = delta(row, sort)
    const host = aliases?.get(row.host) ?? 'unknown-host.invalid'
    const label = !aliases ? row.label : groupBy === 'host' ? host : 'Endpoint ' + (row.index + 1) + ' · ' + host
    return { row, label, rank: change === null ? -1 : Math.abs(change) }
  }).sort((a, b) => b.rank - a.rank || a.row.index - b.row.index), [rows, sort, aliases, groupBy])
  const filtered = useMemo(() => query ? sorted.filter(({ label }) => label.toLowerCase().includes(query)) : sorted, [sorted, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

  return <>
    <div className="comparison-captures">
      {sides.map((side) => {
        const slot = slots[side]
        const title = side === 'baseline' ? 'Baseline' : 'Candidate'
        return <section key={side} className="panel comparison-capture">
          <div><h2>{title}</h2><p title={slot?.name}>{slot ? slot.name : 'Choose a HAR capture'}</p></div>
          <div className="comparison-actions">
            <button className="button button-secondary" type="button" onClick={() => onImport(side)}>
              <Upload size={15} /> {slot ? 'Replace ' : 'Import '}{side}
            </button>
            {slot && <button className="button button-secondary" type="button" onClick={() => onView(side)}>View {side} graph</button>}
            {slot && side === 'candidate' && <button className="plain-link" type="button" onClick={onClearCandidate}>Clear candidate</button>}
          </div>
        </section>
      })}
    </div>
    {!totals ? <section className="panel table-empty"><GitCompareArrows size={28} /><h2>Load both captures to compare</h2><p>Pick a baseline and a candidate to see what changed.</p></section> :
      <section className="panel comparison-panel" aria-labelledby="comparison-title">
        <header className="panel-heading">
          <div className="panel-title-with-icon">
            <div className="section-icon graph-icon"><GitCompareArrows size={18} /></div>
            <div><h2 id="comparison-title">Capture differences</h2><p>Deltas show candidate minus baseline.</p></div>
          </div>
        </header>
        <dl className="comparison-totals">{metrics.map((metric) => <div key={metric.key}><dt>{metric.label}</dt><dd><MetricChange row={totals} metric={metric} /></dd></div>)}</dl>
        <div className="comparison-toolbar">
          <label>Group by<select value={groupBy} onChange={(event) => { setGroupBy(event.target.value as GroupBy); setPage(0) }}>
            <option value="endpoint">Endpoint</option><option value="host">Hostname</option>
          </select></label>
          <label>Sort by largest change<select value={sort} onChange={(event) => { setSort(event.target.value as Metric); setPage(0) }}>
            {metrics.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>Search comparisons<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }}
            autoComplete="off" spellCheck={false} placeholder="Search endpoints or hosts" /></label>
        </div>
        <p className="comparison-note">Endpoints match by method, origin, and redacted path. Query values are ignored. A dash for a delta indicates incomplete measurements or an unavailable timing.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Comparison results">
          <table className="request-table comparison-table">
            <thead><tr><th scope="col">{groupBy === 'endpoint' ? 'Endpoint' : 'Hostname'}</th>
              {metrics.map(({ key, label }) => <th scope="col" key={key}>{label}</th>)}
              <th scope="col">Inspect requests</th>
            </tr></thead>
            <tbody>{visible.map(({ row, label }) => <tr key={row.index}>
              <th scope="row" title={label}>{label}{(!row.baseline.calls || !row.candidate.calls) &&
                <small>{row.baseline.calls ? 'Only in baseline' : 'Only in candidate'}</small>}</th>
              {metrics.map((metric) => <td key={metric.key}><MetricChange row={row} metric={metric} /></td>)}
              <td><div className="comparison-inspect">{sides.map((side) => row.ids[side].length > 0 &&
                <button type="button" className="plain-link" key={side} aria-label={'Inspect ' + side + ' requests for ' + label}
                  onClick={() => onInspect(side, row.ids[side])}>{side === 'baseline' ? 'Baseline' : 'Candidate'}</button>)}</div></td>
            </tr>)}</tbody>
          </table>
          {!visible.length && <div className="table-empty">No matching endpoints or hostnames.</div>}
        </div>
        {pageCount > 1 && <div className="table-footer"><span>Page {currentPage + 1} of {pageCount}</span><div>
          <button type="button" className="icon-button" aria-label="Previous comparison page" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ArrowLeft size={16} /></button>
          <button type="button" className="icon-button" aria-label="Next comparison page" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ArrowRight size={16} /></button>
        </div></div>}
      </section>}
  </>
}
