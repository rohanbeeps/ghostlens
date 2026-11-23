import { useMemo, useState } from 'react'
import { Clipboard, Download } from 'lucide-react'
import { maskedReport } from '../lib/report'
import type { Capture } from '../lib/model'
import { Dialog } from './Dialog'

export function ReportDialog({ capture, onClose }: { capture: Capture; onClose: () => void }) {
  const report = useMemo(() => maskedReport(capture), [capture])
  const [status, setStatus] = useState('')

  async function copy() {
    try {
      await navigator.clipboard.writeText(report)
      setStatus('Masked report copied.')
    } catch {
      setStatus('Clipboard access is unavailable. Select the text or download the Markdown.')
    }
  }

  function download() {
    const link = document.createElement('a')
    link.href = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(report)
    link.download = 'ghostlens-report.md'
    link.click()
  }

  return <Dialog title="Masked capture report" onClose={onClose} wide>
    <p className="dialog-intro">Filenames, hostnames, and URLs are hidden. Review the traffic statistics before sharing.</p>
    <textarea aria-label="Masked Markdown report" className="report-preview" readOnly value={report} spellCheck={false} />
    <div className="report-actions">
      <button type="button" className="button button-primary" onClick={() => void copy()}><Clipboard size={16} /> Copy Markdown</button>
      <button type="button" className="button button-secondary" onClick={download}><Download size={16} /> Download Markdown</button>
      <span role="status">{status}</span>
    </div>
  </Dialog>
}
