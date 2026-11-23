import { useDeferredValue, useMemo, useState } from 'react'
import { ArrowDownUp, ArrowLeft, ArrowRight, ChevronDown, ListFilter, Search, X } from 'lucide-react'
import { count, size, time } from '../lib/format'
import { phaseColor, phaseLabel, phases, type Capture, type Request } from '../lib/model'
import { OTHER_DOMAINS } from '../lib/topology'
import { Dialog } from './Dialog'

export function Status({ status }: { status: number | null }) {
  const family = status === null ? 'unknown' : Math.floor(status / 100)
  return <span className={'http-status http-' + family} title={status === null ? 'Status unavailable' : undefined}>
    <i aria-hidden="true" />{status ?? '—'}
  </span>
}

function Waterfall({ request, horizon }: { request: Request; horizon?: number | null }) {
  if (request.duration === null || (horizon !== undefined && (request.offset === null || horizon === null))) {
    return <span className="unavailable" aria-label="Timing unavailable">—</span>
  }
  const duration = request.duration
  const scale = horizon ?? duration
  const offset = horizon === undefined ? 0 : request.offset ?? 0
  const timings = phases.filter((phase) => (request.timing[phase] ?? 0) > 0)
  const phaseTotal = timings.reduce((sum, phase) => sum + (request.timing[phase] ?? 0), 0)
  const percentOf = (part: number, total: number) => total > 0 ? Math.min(100, 100 * part / total) : 0

  return <div className="waterfall" aria-label={time(request.duration) + ' total' + (horizon === undefined ? '' : ', starts at ' + time(offset))}
    title={time(request.duration) + ' · starts at ' + time(offset)}>
    <div className="waterfall-bar" style={{ left: percentOf(offset, scale) + '%', width: percentOf(duration, scale) + '%' }}>
      {timings.map((phase) => <span key={phase} style={{ width: percentOf(request.timing[phase] ?? 0, Math.max(duration, phaseTotal)) + '%', background: phaseColor[phase] }} />)}
    </div>
  </div>
}

export function RequestDetails({ request, onClose }: { request: Request; onClose: () => void }) {
  return <Dialog title="Request details" wide onClose={onClose}>
    <div className="detail-url">
      <span className="method">{request.method ?? '—'}</span>
      <code>{request.url}</code>
    </div>
    <div className="details-grid">
      <div><span>HTTP status</span><Status status={request.status} /></div>
      <div><span>Domain</span><strong>{request.domain}</strong></div>
      <div><span>Resource type</span><strong>{request.resource ?? 'Unavailable'}</strong></div>
      <div><span>Transferred</span><strong>{request.bytes === null ? 'Unavailable' : size(request.bytes)}</strong></div>
      <div><span>Duration</span><strong>{request.duration === null ? 'Unavailable' : time(request.duration)}</strong></div>
      <div><span>Start offset</span><strong>{request.offset === null ? 'Unavailable' : time(request.offset)}</strong></div>
    </div>
    <h3 className="detail-timing-heading">Timing breakdown</h3>
    <Waterfall request={request} />
    <dl className="timing-list">
      {([...phases, 'ssl'] as const).map((phase) => <div key={phase}>
        <dt><i style={{ background: phaseColor[phase] }} />{phaseLabel[phase]}</dt>
        <dd>{request.timing[phase] === null ? 'Unavailable' : time(request.timing[phase])}</dd>
      </div>)}
    </dl>
  </Dialog>
}

function Filter({ label, value, onChange, children }: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return <label className="select-wrap">
    <span className="sr-only">{label}</span>
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
    <ChevronDown size={13} aria-hidden="true" />
  </label>
}

export type RequestScope = { label: string; ids: ReadonlySet<number> }

export function Requests({ capture, domain, grouped, onClearDomain, scope, onClearScope, onInspect, full = false }: {
  capture: Capture
  domain: string | null
  grouped: Set<string>
  onClearDomain: () => void
  scope?: RequestScope | null
  onClearScope?: () => void
  onInspect: (request: Request) => void
  full?: boolean
}) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [resource, setResource] = useState('')
  const [party, setParty] = useState('')
  const [sort, setSort] = useState(false)
  const [pagination, setPagination] = useState<{ key: string; index: number; scope: typeof scope }>({ key: '', index: 0, scope })
  const query = useDeferredValue(search.trim().toLowerCase())
  const resources = useMemo(() => [...new Set(capture.requests.flatMap((request) => request.resource ?? []))].sort(), [capture])
  const filtered = useMemo(() => {
    const results = capture.requests.filter((request) => {
      if (scope && !scope.ids.has(request.id)) return false
      if (domain && (domain === OTHER_DOMAINS ? !grouped.has(request.domain) : request.domain !== domain)) return false
      if (status && (request.status === null ? status !== 'unknown' : String(Math.floor(request.status / 100)) !== status)) return false
      if (resource && (request.resource ?? 'unknown') !== resource) return false
      if (party && request.firstParty !== (party === 'first')) return false
      return !query || (request.url + ' ' + (request.method ?? '') + ' ' + (request.resource ?? '') + ' ' + (request.status ?? '')).toLowerCase().includes(query)
    })
    if (sort) results.sort((a, b) => (b.duration ?? -1) - (a.duration ?? -1))
    return results
  }, [capture, domain, grouped, scope, status, resource, party, query, sort])

  const pageSize = full ? 16 : 7
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginationKey = JSON.stringify([domain, query, status, resource, party, sort, full])
  const filtersChanged = pagination.key !== paginationKey || pagination.scope !== scope
  if (filtersChanged) setPagination({ key: paginationKey, index: 0, scope })
  const page = filtersChanged ? 0 : Math.min(pagination.index, pageCount - 1)
  const setPage = (index: number) => setPagination({ key: paginationKey, index, scope })
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize)
  function clear() {
    setSearch('')
    setStatus('')
    setResource('')
    setParty('')
    setSort(false)
    onClearDomain()
    onClearScope?.()
  }

  return <section className="panel request-panel" aria-labelledby="requests-title">
    <header className="panel-heading request-heading">
      <div className="panel-title-with-icon">
        <div className="section-icon request-icon"><ListFilter size={17} /></div>
        <div><h2 id="requests-title">Request Inspector</h2><p>Inspect individual requests and their timing.</p></div>
      </div>
      <div className="request-search">
        <Search size={16} aria-hidden="true" />
        <input aria-label="Search requests" placeholder="Search requests…" value={search} autoComplete="off" spellCheck={false} onChange={(event) => setSearch(event.target.value)} />
        {search && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}
      </div>
    </header>
    <div className="filter-bar">
      <Filter label="Filter by HTTP status" value={status} onChange={setStatus}>
        <option value="">All statuses</option>
        {[1, 2, 3, 4, 5].map((family) => <option value={family} key={family}>{family}xx</option>)}
        <option value="unknown">Unavailable</option>
      </Filter>
      <Filter label="Filter by resource type" value={resource} onChange={setResource}>
        <option value="">All types</option>
        {resources.map((type) => <option key={type} value={type}>{type}</option>)}
        <option value="unknown">Unavailable</option>
      </Filter>
      <Filter label="Filter by party" value={party} onChange={setParty}>
        <option value="">All parties</option>
        <option value="first">First-party</option><option value="third">Third-party</option>
      </Filter>
      {domain && <button type="button" className="filter-chip" onClick={onClearDomain} title="Clear domain filter">
        {domain === OTHER_DOMAINS ? 'Grouped domains' : domain}<X size={14} />
      </button>}
      {scope && <button type="button" className="filter-chip" onClick={onClearScope} title="Clear request selection">
        {scope.label}<X size={14} />
      </button>}
      <span className="results-count" aria-live="polite">{count(filtered.length)} of {count(capture.requests.length)} requests</span>
    </div>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Network requests">
      <table className="request-table">
        <thead><tr>
          <th scope="col">Request</th><th scope="col">Domain</th><th scope="col">Status</th><th scope="col">Type</th>
          <th scope="col" className="number" aria-sort={sort ? 'descending' : 'none'}><button type="button" onClick={() => setSort(!sort)} title="Toggle sort by duration">Duration <ArrowDownUp size={12} /></button></th>
          <th scope="col" className="number">Transferred</th><th scope="col">Waterfall</th>
        </tr></thead>
        <tbody>
          {visible.map((request) => <tr key={request.id} onClick={() => onInspect(request)}>
            <td><button type="button" className="request-link" title={request.url} onClick={(event) => { event.stopPropagation(); onInspect(request) }}>
              <span className={'method method-' + (request.method ?? 'unknown').toLowerCase()}>{request.method ?? '—'}</span>
              <span>{request.path}</span>
            </button></td>
            <td><span className="table-domain" title={request.domain}>{request.domain}</span></td>
            <td><Status status={request.status} /></td><td className="cell-quiet">{request.resource ?? '—'}</td>
            <td className="number">{time(request.duration)}</td><td className="number">{size(request.bytes)}</td>
            <td className="waterfall-cell"><Waterfall request={request} horizon={capture.duration} /></td>
          </tr>)}
        </tbody>
      </table>
      {!visible.length && <div className="table-empty">
        <Search size={25} />
        <h3>{capture.requests.length ? 'No matching requests' : 'No requests in this capture'}</h3>
        <p>{capture.requests.length ? 'Try another search or clear the active filters.' : 'Record network activity in your browser before exporting a HAR.'}</p>
        {capture.requests.length > 0 && <button className="button button-secondary" type="button" onClick={clear}>Clear filters</button>}
      </div>}
    </div>
    {pageCount > 1 && <footer className="table-footer">
      <span>Showing {count(page * pageSize + 1)}–{count(Math.min(filtered.length, (page + 1) * pageSize))} of {count(filtered.length)}</span>
      <div><button type="button" className="icon-button" aria-label="Previous request page" disabled={!page} onClick={() => setPage(page - 1)}><ArrowLeft size={16} /></button>
      <span>Page {page + 1} of {pageCount}</span>
      <button type="button" className="icon-button" aria-label="Next request page" disabled={page === pageCount - 1} onClick={() => setPage(page + 1)}><ArrowRight size={16} /></button></div>
    </footer>}
  </section>
}
