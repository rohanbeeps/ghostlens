import { ArrowRight, ScanLine } from 'lucide-react'
import { useMemo } from 'react'
import { analyzeFindings, type Finding } from '../lib/findings'
import { count } from '../lib/format'
import type { Capture } from '../lib/model'

export function Findings({ capture, onInspect }: { capture: Capture; onInspect: (finding: Finding) => void }) {
  const findings = useMemo(() => analyzeFindings(capture), [capture])
  return <section className="panel findings-panel" aria-labelledby="findings-title">
    <header className="panel-heading"><div className="panel-title-with-icon">
      <div className="section-icon request-icon"><ScanLine size={17} /></div>
      <div><h2 id="findings-title">Findings</h2><p>Open the requests behind each finding.</p></div>
    </div></header>
    {findings.length ? <ul className="findings-list">{findings.map((finding) => <li key={finding.id}>
      <div><h3>{finding.title}</h3><p>{finding.explanation}</p></div>
      <button type="button" className="button button-secondary" aria-label={'Inspect ' + finding.title.toLowerCase()}
        onClick={() => onInspect(finding)}>{count(finding.ids.length)} requests <ArrowRight size={15} /></button>
    </li>)}</ul> : <p className="comparison-note">No findings met the thresholds for repeated calls, response waits, large transfers, or third-party HTTP errors.</p>}
  </section>
}
