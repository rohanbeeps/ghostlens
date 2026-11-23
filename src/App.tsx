import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  Activity, ArrowUpRight, Box, ChartNoAxesColumn, ChevronRight, CircleHelp, Eye, FileJson, FileText,
  FlaskConical, GitCompareArrows, LayoutDashboard, List, LoaderCircle, LockKeyhole, ShieldCheck, TriangleAlert,
  Upload, Waypoints, X,
} from 'lucide-react'
import { Analytics, Domains, Stats } from './components/Analytics'
import { Compare } from './components/Compare'
import { Dialog } from './components/Dialog'
import { Findings } from './components/Findings'
import { ReportDialog } from './components/ReportDialog'
import { RequestDetails, Requests, type RequestScope } from './components/Requests'
import type { CaptureSide } from './lib/compare'
import { count } from './lib/format'
import { hostAliases, maskCapture } from './lib/maskCapture'
import type { Request } from './lib/model'
import { topology } from './lib/topology'
import { useCapture } from './lib/useCapture'

const NetworkGraph = lazy(() => import('./components/NetworkGraph'))
const navigation = [
  { id: 'overview', label: 'Observatory', icon: LayoutDashboard },
  { id: 'requests', label: 'Requests', icon: List },
  { id: 'analytics', label: 'Analytics', icon: ChartNoAxesColumn },
  { id: 'compare', label: 'Compare', icon: GitCompareArrows },
] as const
type View = (typeof navigation)[number]['id']

const viewContent: Record<View, { title: string; summary: string }> = {
  overview: { title: 'Network Observatory', summary: 'Explore the requests, domains, and connections behind your browser traffic.' },
  requests: { title: 'Network Requests', summary: 'Search, filter, and inspect the individual requests in this capture.' },
  analytics: { title: 'Capture Analytics', summary: 'Find latency bottlenecks, response errors, and third-party traffic.' },
  compare: { title: 'Compare Captures', summary: 'See how requests, transfers, timings, and errors changed between two HAR files.' },
}

function GraphLoading() {
  return <section className="panel graph-panel graph-loading" aria-live="polite">
    <div className="graph-message"><LoaderCircle className="spin" size={24} /><strong>Preparing the 3D view</strong></div>
  </section>
}

export default function App() {
  const baseline = useCapture()
  const candidate = useCapture(false)
  const [side, setSide] = useState<CaptureSide>('baseline')
  const [view, setView] = useState<View>('overview')
  const [domain, setDomain] = useState<string | null>(null)
  const [scope, setScope] = useState<RequestScope | null>(null)
  const [request, setRequest] = useState<Request | null>(null)
  const [dialog, setDialog] = useState<'import' | 'baseline' | 'candidate' | 'help' | 'report' | null>(null)
  const [masked, setMasked] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragCount = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const active = side === 'candidate' && candidate.data ? candidate : baseline
  const { data } = active
  const baselineCapture = baseline.data?.capture
  const candidateCapture = candidate.data?.capture
  const aliases = useMemo(() => masked ? hostAliases(baselineCapture, candidateCapture) : null, [masked, baselineCapture, candidateCapture])
  const feedback = view === 'compare' && (candidate.error || candidate.loading) ? candidate : view === 'compare' ? baseline : active
  const { loading, error, dismissError } = feedback
  const source = data?.capture
  const capture = useMemo(() => source && aliases ? maskCapture(source, aliases) : source, [source, aliases])
  const captureName = masked ? 'Masked capture' : data?.name
  const captureKey = data ? side + ':' + data.id + ':' + masked : undefined
  const graph = useMemo(() => capture ? topology(capture) : null, [capture])
  const toggleDomain = useCallback((name: string) => setDomain((current) => current === name ? null : name), [])
  const current = navigation.find((item) => item.id === view)!

  useEffect(() => {
    document.title = 'GHOSTLENS — ' + current.label
  }, [current.label])

  function navigate(next: View) {
    setView(next)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  function resetInspection() {
    setDomain(null)
    setScope(null)
    setRequest(null)
  }

  function openCapture(file?: File, target: CaptureSide = 'baseline', compare = false) {
    setDialog(null)
    if (target === side || !compare) resetInspection()
    setDragState(false)
    if (!compare) setSide('baseline')
    navigate(compare ? 'compare' : 'overview')
    void (target === 'candidate' ? candidate.open(file) : baseline.open(file))
  }

  function closeCapture() {
    active.clear()
    resetInspection()
    setSide('baseline')
    navigate('overview')
  }

  function toggleMask() {
    setMasked((current) => !current)
    resetInspection()
  }

  function viewGraph(target: CaptureSide) {
    setSide(target)
    resetInspection()
    navigate('overview')
  }

  function inspectScope(target: CaptureSide, ids: number[], label: string) {
    setSide(target)
    setDomain(null)
    setScope({ label, ids: new Set(ids) })
    navigate('requests')
  }

  function clearCandidate() {
    candidate.clear()
    if (side === 'candidate') {
      resetInspection()
      setSide('baseline')
    }
  }

  function setDragState(active: boolean) {
    if (!active) dragCount.current = 0
    setDragging(active)
  }

  function dragEnter(event: DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragCount.current += 1
    setDragging(true)
  }

  function dragLeave(event: DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragCount.current = Math.max(0, dragCount.current - 1)
    if (!dragCount.current) setDragging(false)
  }

  function drop(event: DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragState(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    if (dialog === 'baseline' || dialog === 'candidate') openCapture(file, dialog, true)
    else if (view === 'compare' && dialog !== 'import') openCapture(file, baseline.data ? 'candidate' : 'baseline', true)
    else openCapture(file)
  }

  return <div className="app-shell" onDragEnter={dragEnter} onDragLeave={dragLeave} onDrop={drop}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <a className="brand" aria-label="GHOSTLENS home" href="#" onClick={(event) => { event.preventDefault(); navigate('overview') }}>
        <div className="brand-mark"><Eye size={22} strokeWidth={1.8} /></div>
        <div><span className="brand-name">GHOST<span>LENS</span></span><span className="brand-tagline">X-Ray the Invisible Internet</span></div>
      </a>
      <div className="sidebar-workspace">
        <p className="sidebar-label">Workspace</p>
        <nav aria-label="Workspace">
          {navigation.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-label={label} title={label} onClick={() => navigate(id)}
            aria-current={view === id ? 'page' : undefined} className={'nav-item' + (view === id ? ' nav-active' : '')}>
            <Icon size={17} strokeWidth={1.75} /><span>{label}</span>{view === id && <i aria-hidden="true" />}
          </button>)}
        </nav>
      </div>
      <div className="sidebar-capture">
        <p className="sidebar-label">Active capture</p>
        {data ? <div className="capture-file">
          <FileJson className="capture-file-icon" size={17} />
          <div><strong title={captureName}>{captureName}</strong><small>{data.demo ? 'Synthetic sample' : count(data.capture.requests.length) + ' requests'}</small></div>
          <button type="button" className="icon-button" onClick={closeCapture} aria-label="Clear capture" title="Clear capture"><X size={14} /></button>
        </div> : <button className="capture-placeholder" type="button" onClick={() => setDialog('import')}><FileJson size={16} /> Open a capture</button>}
      </div>
      <div className="sidebar-bottom">
        <div className="local-card"><ShieldCheck size={17} /><div><strong>Private by design</strong><p>Captures stay on this device.</p></div></div>
        <button type="button" className="nav-item help-button" aria-label="Privacy & help" title="Privacy & help" onClick={() => setDialog('help')}><CircleHelp size={17} /><span>Privacy &amp; help</span><ArrowUpRight size={13} /></button>
        <span className="sidebar-version">v0.1.0 <i /> MIT License</span>
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumb"><Box size={16} /><span>Workspace</span><ChevronRight size={13} /><strong>{current.label}</strong></div>
        <div className="top-actions">
          <span className="local-status"><i />Local only</span>
          <button className="button button-secondary demo-button" type="button" onClick={() => openCapture()}><FlaskConical size={16} /> <span>Load demo</span></button>
          <button className="button button-primary" type="button" onClick={() => setDialog('import')}><Upload size={16} /> <span>Import HAR</span></button>
        </div>
      </header>
      <main id="main-content" className="main-content">
        <div className="page-heading">
          <div><h1>{viewContent[view].title}</h1><p>{viewContent[view].summary}</p></div>
          <div className="page-heading-actions">
            {data && view !== 'compare' && <span className={'capture-badge' + (data.demo ? ' demo-badge' : '')}>
              {data.demo ? <FlaskConical size={14} /> : <FileJson size={14} />}
              <span title={captureName}>{data.demo && !masked ? 'Demo capture' : captureName}</span>
            </span>}
            {source && view === 'analytics' && <button className="button button-secondary" type="button" onClick={() => setDialog('report')}>
              <FileText size={16} /> Masked report
            </button>}
          </div>
        </div>
        {loading && <div className="notice loading-notice" role="status"><LoaderCircle className="spin" size={17} /><span>Parsing capture on this device…</span></div>}
        {error && <div className="notice error-notice" role="alert"><TriangleAlert size={19} />
          <div><strong>Couldn’t open capture</strong><p>{error}</p></div>
          <button className="icon-button" type="button" aria-label="Dismiss error" onClick={dismissError}><X size={17} /></button>
        </div>}
        {capture && (capture.skipped > 0 || capture.limited > 0) && <div className="notice limit-notice" role="status">
          <TriangleAlert size={17} /><span>{[
            capture.skipped > 0 && count(capture.skipped) + ' invalid or unsupported entries skipped.',
            capture.limited > 0 && count(capture.limited) + ' entries omitted after the 40,000-entry limit.',
          ].filter(Boolean).join(' ')}</span>
        </div>}
        {view === 'compare' ? <Compare key={[baseline.data?.id, candidate.data?.id, masked].join(':')}
          slots={{
            baseline: baseline.data ? { capture: baseline.data.capture, name: masked ? 'Masked baseline' : baseline.data.name } : null,
            candidate: candidate.data ? { capture: candidate.data.capture, name: masked ? 'Masked candidate' : candidate.data.name } : null,
          }} aliases={aliases} onImport={setDialog} onView={viewGraph}
          onInspect={(target, ids) => inspectScope(target, ids, target === 'baseline' ? 'Baseline matches' : 'Candidate matches')}
          onClearCandidate={clearCandidate} /> : capture && graph ? <>
          {view !== 'requests' && <Stats capture={capture} />}
          {view === 'overview' && <div className="observatory-grid">
            <Suspense fallback={<GraphLoading />}>
              <NetworkGraph key={captureKey} capture={capture} nodes={graph.nodes} hidden={graph.hidden} selected={domain} onSelect={toggleDomain} />
            </Suspense>
            <Domains capture={capture} selected={domain} onSelect={toggleDomain} onViewAll={() => navigate('analytics')} />
          </div>}
          {view === 'analytics' ? <>
            <Findings capture={source ?? capture} onInspect={(finding) => inspectScope(side, finding.ids, finding.title)} />
            <Analytics key={captureKey} capture={capture} onInspect={setRequest} onSelect={(name) => { setScope(null); setDomain(name); navigate('requests') }} />
          </> : <Requests capture={capture} key={captureKey} domain={domain} grouped={graph.hidden} onClearDomain={() => setDomain(null)}
            scope={scope} onClearScope={() => setScope(null)} onInspect={setRequest} full={view === 'requests'} />}
        </> : <div className="panel empty-capture">
          <div className="empty-icon"><Waypoints size={34} strokeWidth={1.4} /></div>
          <h2>{loading ? 'Opening the observatory' : 'No capture loaded'}</h2>
          <p>{loading ? 'The request inspector and topology will appear here.' : 'Drop a HAR file anywhere, or open the synthetic demo to explore the observatory.'}</p>
          {!loading && <div className="empty-actions">
            <button className="button button-primary" type="button" onClick={() => setDialog('import')}><Upload size={16} /> Import HAR</button>
            <button className="button button-secondary" type="button" onClick={() => openCapture()}><FlaskConical size={16} /> Load demo</button>
          </div>}
        </div>}
        <footer className="workspace-footer"><Activity size={13} /><span>GHOSTLENS</span><span>All analysis runs in your browser.</span></footer>
      </main>
    </div>

    <input type="file" ref={input} accept=".har,.json,application/json" hidden onChange={(event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      if (dialog === 'candidate' || dialog === 'baseline') openCapture(file, dialog, true)
      else openCapture(file)
    }} />
    {dragging && <div className="drop-mask" aria-hidden="true"><div><Upload size={38} /><strong>Drop your HAR file</strong><span>It stays on this device.</span></div></div>}

    {(dialog === 'import' || dialog === 'baseline' || dialog === 'candidate') && <Dialog
      title={dialog === 'import' ? 'Import a HAR capture' : 'Import ' + dialog + ' HAR'} onClose={() => setDialog(null)}>
      <p className="dialog-intro">Open a HAR 1.2 recording exported from your browser’s Network panel.</p>
      <button className={'import-dropzone' + (dragging ? ' import-dropzone-active' : '')} type="button" onClick={() => input.current?.click()}>
        <Upload size={25} /><strong>Choose a HAR file</strong><span>or drop it here · Up to 40 MiB</span>
      </button>
      <div className="dialog-privacy"><LockKeyhole size={17} /><p>HAR files can contain credentials and personal data. GHOSTLENS processes files locally and displays a redacted view.</p></div>
    </Dialog>}
    {dialog === 'report' && source && <ReportDialog capture={source} onClose={() => setDialog(null)} />}
    {dialog === 'help' && <Dialog title="Privacy & help" onClose={() => setDialog(null)}>
      <div className="help-copy">
        <h3>Share the observatory view</h3>
        <p id="mask-description">Replace capture filenames, hostnames, and paths with placeholders. Traffic counts and timings stay visible.</p>
        <button className="button button-secondary mask-toggle" type="button" aria-pressed={masked} aria-describedby="mask-description" onClick={toggleMask}>
          <LockKeyhole size={16} /> Mask capture details
        </button>
        <h3>Open a local capture</h3>
        <p>In your browser’s developer tools, open Network, record traffic, and export as HAR. Use a sanitized export when your browser offers it. Import the saved file or drag it onto the observatory.</p>
        <h3>What GHOSTLENS displays</h3>
        <p>URL usernames, passwords, queries, and fragments are removed. Common token patterns in paths are masked. Headers, cookies, and bodies are discarded. Hostnames, filenames, and other path segments can still contain private information.</p>
        <h3>How to read the topology</h3>
        <p>Nodes represent contacted hostnames. Lines connect each hostname to the capture’s primary domain. First-party uses the same registrable domain as the primary document.</p>
      </div>
    </Dialog>}
    {request && <RequestDetails request={request} onClose={() => setRequest(null)} />}
  </div>
}
