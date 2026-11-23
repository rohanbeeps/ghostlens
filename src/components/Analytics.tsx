import { useMemo, useState } from 'react'
import { Activity, ArrowDownRight, ArrowLeft, ArrowRight, Database, Globe2, Layers3, Timer, TriangleAlert } from 'lucide-react'
import type { Capture, Domain, Request } from '../lib/model'
import { count, percent, size, time } from '../lib/format'
import { Status } from './Requests'

export function Stats({ capture }: { capture: Capture }) {
  const stat = [
    { label: 'Total Requests', value: count(capture.requests.length), detail: count(capture.domains.length) + ' unique domains', Icon: Activity, hue: 'cyan' },
    { label: 'Transferred', value: size(capture.totalBytes), detail: capture.measured ? 'Across ' + count(capture.measured) + ' measured requests' : 'Transfer size unavailable', Icon: Database, hue: 'violet' },
    { label: 'HTTP Errors', value: count(capture.errors), detail: '4xx and 5xx responses', Icon: TriangleAlert, hue: 'rose' },
    { label: 'Third-party', value: count(capture.thirdParty), detail: percent(capture.thirdParty, capture.requests.length) + ' of all requests', Icon: Globe2, hue: 'amber' },
  ]
  return <section className="stats-grid" aria-label="Capture summary">
    {stat.map(({ label, value, detail, Icon, hue }) => <article className="stat-card panel" key={label}>
      <div className="stat-top"><span>{label}</span><div className={'stat-icon tone-' + hue}><Icon size={17} strokeWidth={1.7} /></div></div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>)}
  </section>
}

export function Domains({ capture, selected, onSelect, onViewAll }: {
  capture: Capture
  selected: string | null
  onSelect: (name: string) => void
  onViewAll: () => void
}) {
  const domains = capture.domains.slice(0, 6)
  return <section className="panel domain-panel" aria-labelledby="domains-title">
    <header className="panel-heading">
      <div className="panel-title-with-icon">
        <div className="section-icon domain-icon"><Layers3 size={16} /></div>
        <div><h2 id="domains-title">Domains</h2><p>Traffic by hostname</p></div>
      </div>
      <span className="domain-count">{count(capture.domains.length)}</span>
    </header>
    <div className="domain-columns"><span>Hostname</span><span>Requests</span></div>
    <div className="domain-list">
      {domains.map((domain) => <button key={domain.name} type="button" aria-pressed={selected === domain.name}
        className={'domain-row' + (selected === domain.name ? ' domain-active' : '')} onClick={() => onSelect(domain.name)}>
        <span className="domain-label"><i className={domain.firstParty ? 'first-party' : 'third-party'} />
          <span title={domain.name}>{domain.name}</span>
        </span>
        <span className="domain-quantity">{count(domain.requests)}</span>
        <span className="domain-mini-track"><span className={domain.firstParty ? 'first-party' : 'third-party'}
          style={{ width: 100 * domain.requests / (domains[0]?.requests || 1) + '%' }} /></span>
      </button>)}
      {!domains.length && <p className="domain-empty">No domains in this capture.</p>}
    </div>
    <button className="view-domains" type="button" onClick={onViewAll}>View domain breakdown <ArrowRight size={15} /></button>
  </section>
}

function TimingSummary({ capture }: { capture: Capture }) {
  const stats = useMemo(() => {
    const durations = capture.requests.flatMap((request) => request.duration ?? []).sort((a, b) => a - b)
    const percentile = (rank: number) => durations.length ? durations[Math.ceil(rank * durations.length) - 1] : null
    return [
      ['Capture span', time(capture.duration)], ['Median request', time(percentile(0.5))],
      ['95th percentile', time(percentile(0.95))], ['Timed requests', count(durations.length)],
    ]
  }, [capture])
  return <section className="panel analysis-card">
    <header className="panel-heading"><div className="panel-title-with-icon"><div className="section-icon request-icon"><Timer size={17} /></div>
      <div><h2>Request timings</h2><p>Latency across measured requests</p></div></div></header>
    <dl className="analysis-timings">{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>
}

export function Analytics({ capture, onInspect, onSelect }: {
  capture: Capture
  onInspect: (request: Request) => void
  onSelect: (domain: string) => void
}) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(capture.domains.length / 12))
  const current = Math.min(page, pages - 1)
  const visible = capture.domains.slice(current * 12, (current + 1) * 12)
  const domainSize = (domain: Domain) => size(domain.measured ? domain.bytes : null)
  return <>
    <div className="analysis-grid">
      <section className="panel analysis-card">
        <header className="panel-heading"><div className="panel-title-with-icon"><div className="section-icon domain-icon"><Activity size={17} /></div>
          <div><h2>Status distribution</h2><p>Responses by HTTP status family</p></div></div></header>
        <div className="status-chart">
          <div className="status-bar" aria-hidden="true">{capture.statuses.map(({ label, count: total, color }) => total > 0 &&
            <span key={label} style={{ background: color, width: 100 * total / capture.requests.length + '%' }} />)}</div>
          <ul>{capture.statuses.map(({ label, count: total, color }) => <li key={label}><i style={{ background: color }} />{label}<strong>{count(total)}</strong></li>)}</ul>
        </div>
      </section>
      <TimingSummary capture={capture} />
      <section className="panel analysis-card">
        <header className="panel-heading"><div className="panel-title-with-icon"><div className="section-icon request-icon"><ArrowDownRight size={17} /></div>
          <div><h2>Slowest requests</h2><p>Longest measured durations</p></div></div></header>
        <div className="slow-list">{capture.slowest.length ? capture.slowest.map((request) =>
          <button key={request.id} type="button" onClick={() => onInspect(request)} title={request.url}>
            <Status status={request.status} /><span>{request.domain + request.path}</span><strong>{time(request.duration)}</strong>
          </button>) : <p>Request durations are unavailable.</p>}</div>
      </section>
    </div>
    <section className="panel">
      <header className="panel-heading"><div className="panel-title-with-icon"><div className="section-icon domain-icon"><Globe2 size={17} /></div>
        <div><h2>Domain breakdown</h2><p>Requests, party classification, transfer measurements, and HTTP errors by hostname.</p></div>
      </div></header>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Domain breakdown">
        <table className="request-table analysis-table"><thead><tr>
          <th scope="col">Hostname</th><th scope="col">Party</th><th scope="col" className="number">Requests</th>
          <th scope="col" className="number">Transferred</th><th scope="col" className="number">Errors</th>
        </tr></thead><tbody>
          {visible.map((domain) => <tr key={domain.name}><td><button className="plain-link" type="button" onClick={() => onSelect(domain.name)}>{domain.name}</button></td>
            <td><span className="domain-label"><i className={domain.firstParty ? 'first-party' : 'third-party'} />{domain.firstParty ? 'First-party' : 'Third-party'}</span></td>
            <td className="number">{count(domain.requests)}</td><td className="number">{domainSize(domain)}</td><td className="number">{count(domain.errors)}</td></tr>)}
        </tbody></table>
        {!visible.length && <p className="domain-empty">No domains in this capture.</p>}
      </div>
      {pages > 1 && <footer className="table-footer"><span>{count(capture.domains.length)} domains</span><div>
        <button type="button" className="icon-button" aria-label="Previous domain page" disabled={!current} onClick={() => setPage(current - 1)}><ArrowLeft size={16} /></button>
        <span>Page {current + 1} of {pages}</span>
        <button type="button" className="icon-button" aria-label="Next domain page" disabled={current === pages - 1} onClick={() => setPage(current + 1)}><ArrowRight size={16} /></button>
      </div></footer>}
    </section>
  </>
}
