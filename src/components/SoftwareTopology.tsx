import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'
import { count, size } from '../lib/format'
import { GROUPED_COLOR, nodeRadius, type GraphNode } from '../lib/topology'

export type GraphMetric = 'requests' | 'bytes'
export type CameraCommand = { action: 'in' | 'out' | 'reset' }
export const CAMERA: [number, number, number] = [0, 6.2, 11.3]
export const ORIGIN: [number, number, number] = [0, -0.25, 0]
const CYAN = '#54daf5'
const VIOLET = '#ad82ff'

type Point = { x: number; y: number; z: number }
type Project = (position: [number, number, number]) => Point
const initialCamera = {
  yaw: 0,
  pitch: Math.atan2(CAMERA[1] - ORIGIN[1], CAMERA[2]),
  distance: Math.hypot(CAMERA[1] - ORIGIN[1], CAMERA[2]),
}

function line(context: CanvasRenderingContext2D, from: Point, to: Point) {
  if (from.z >= 1 || to.z >= 1 || from.z < -1 || to.z < -1) return
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.lineTo(to.x, to.y)
  context.stroke()
}

function drawGround(context: CanvasRenderingContext2D, project: Project) {
  context.strokeStyle = '#50638928'
  for (let coordinate = -10; coordinate <= 10; coordinate += 0.8) {
    for (let segment = -10; segment < 10; segment += 1) {
      line(context, project([coordinate, -1.24, segment]), project([coordinate, -1.24, segment + 1]))
      line(context, project([segment, -1.24, coordinate]), project([segment + 1, -1.24, coordinate]))
    }
  }
}

function drawOrb(context: CanvasRenderingContext2D, point: Point, radius: number, color: string) {
  const { x, y } = point
  const halo = context.createRadialGradient(x, y, radius * 0.35, x, y, radius * 2.35)
  halo.addColorStop(0, color + '72')
  halo.addColorStop(1, color + '00')
  context.fillStyle = halo
  context.fillRect(x - radius * 2.35, y - radius * 2.35, radius * 4.7, radius * 4.7)

  context.beginPath()
  context.ellipse(x, y + radius * 0.15, radius * 1.58, radius * 0.51, 0, 0, Math.PI * 2)
  context.strokeStyle = color + '66'
  context.stroke()

  const sphere = context.createRadialGradient(x - radius * 0.31, y - radius * 0.45, 0, x, y, radius)
  sphere.addColorStop(0, '#e0f8ff')
  sphere.addColorStop(0.35, color)
  sphere.addColorStop(0.82, '#172643')
  sphere.addColorStop(1, color)
  context.fillStyle = sphere
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
}

export function SoftwareTopology({ nodes, metric, selected, hidden, command, onSelect }: {
  nodes: GraphNode[]
  metric: GraphMetric
  selected: string | null
  hidden: Set<string>
  command: CameraCommand | null
  onSelect: (name: string) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ x: number; y: number; id: number } | null>(null)
  const [bounds, setBounds] = useState({ width: 1, height: 1 })
  const [view, setView] = useState(initialCamera)
  const [hover, setHover] = useState<string | null>(null)

  function zoom(factor: number) {
    setView((current) => ({ ...current, distance: Math.max(4.5, Math.min(28, current.distance * factor)) }))
  }

  useEffect(() => {
    if (!command) return
    if (command.action === 'reset') setView(initialCamera)
    else zoom(command.action === 'in' ? 0.80 : 1.25)
  }, [command])

  useEffect(() => {
    if (!container.current) return
    const element = container.current
    const observer = new ResizeObserver(([{ contentRect }]) => {
      setBounds({ width: Math.max(1, contentRect.width), height: Math.max(1, contentRect.height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(() => {
    const { width, height } = bounds
    const camera = new PerspectiveCamera(34, width / height, 0.1, 55)
    const planar = Math.cos(view.pitch) * view.distance
    camera.position.set(Math.sin(view.yaw) * planar, Math.sin(view.pitch) * view.distance + ORIGIN[1], Math.cos(view.yaw) * planar)
    camera.lookAt(...ORIGIN)
    camera.zoom = Math.min(1, width / 590)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    const point = new Vector3()
    const project: Project = (position) => {
      point.set(...position).project(camera)
      return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2, z: point.z }
    }
    const maximum = Math.max(1, ...nodes.filter((node) => !node.grouped).map(({ domain }) => domain[metric]))
    return {
      project,
      spheres: nodes.map((node, index) => {
        const center = project(node.position)
        const radius = nodeRadius(node, metric, maximum)
        const edge = project([node.position[0], node.position[1] + radius, node.position[2]])
        return { node, index, center, radius: Math.max(3, Math.min(120, Math.hypot(edge.x - center.x, edge.y - center.y))),
          color: node.grouped ? GROUPED_COLOR : node.domain.firstParty ? CYAN : VIOLET }
      }),
    }
  }, [bounds, view, nodes, metric])

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context || !canvas.current) return
    const ratio = Math.min(1.65, window.devicePixelRatio || 1)
    canvas.current.width = Math.round(bounds.width * ratio)
    canvas.current.height = Math.round(bounds.height * ratio)
    context.scale(ratio, ratio)
    const { project, spheres } = layout
    drawGround(context, project)
    const root = spheres[0]
    for (const orb of spheres.slice(1)) {
      const from = root.center
      const to = orb.center
      if (from.z < -1 || to.z < -1 || from.z >= 1 || to.z >= 1) continue
      context.strokeStyle = orb.color + '66'
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.quadraticCurveTo((from.x + to.x) / 2, (from.y + to.y) / 2 - 19, to.x, to.y)
      context.stroke()
    }
    for (const orb of [...spheres].sort((a, b) => b.center.z - a.center.z)) {
      if (orb.center.z < -1 || orb.center.z >= 1) continue
      drawOrb(context, orb.center, orb.radius, orb.color)
    }
  }, [bounds, layout])

  function move(event: PointerEvent<HTMLDivElement>) {
    const previous = anchor.current
    if (!previous || previous.id !== event.pointerId) return
    anchor.current = { x: event.clientX, y: event.clientY, id: event.pointerId }
    const dx = event.clientX - previous.x
    const dy = event.clientY - previous.y
    setView((current) => ({ ...current, yaw: current.yaw - dx * 0.009,
      pitch: Math.max(0.04, Math.min(1.53, current.pitch + dy * 0.009)) }))
  }

  return <div ref={container} className="software-topology" onPointerDown={(event) => {
    if (event.button !== 0 || event.target instanceof HTMLElement && event.target.closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    anchor.current = { x: event.clientX, y: event.clientY, id: event.pointerId }
  }} onPointerMove={move} onLostPointerCapture={() => { anchor.current = null }} onWheel={(event) => {
    if (event.shiftKey) zoom(event.deltaY < 0 ? 0.92 : 1.09)
  }}>
    <canvas ref={canvas} aria-hidden="true" />
    {layout.spheres.filter((orb) => orb.center.z >= -1 && orb.center.z < 1).map(({ node, center, index, radius }) => {
      const name = node.grouped ? count(hidden.size) + ' more domains' : node.domain.name
      const isSelected = selected === node.domain.name
      const highlighted = isSelected || Boolean(node.grouped && selected && hidden.has(selected))
      const focused = hover === node.domain.name
      const showLabel = node.grouped || index < (bounds.width < 460 ? 3 : 10) || highlighted || focused
      return <div className="software-point" key={node.domain.name} style={{ left: center.x, top: center.y }}>
        <button className="software-node-hit" type="button" style={{ width: radius * 2, height: radius * 2 }}
          aria-label={'Inspect domain ' + name} aria-pressed={isSelected} onClick={() => onSelect(node.domain.name)}
          onFocus={() => setHover(node.domain.name)} onBlur={() => setHover(null)}
          onPointerEnter={() => setHover(node.domain.name)} onPointerLeave={() => setHover(null)}>
          {showLabel && <span className={'node-label' + (node.root ? ' node-label-root' : '') + (highlighted ? ' node-label-active' : '')}>{name}</span>}
        </button>
        {focused && <div className="node-tooltip" style={{ bottom: radius + 8 }}><strong>{name}</strong>
          <span>{count(node.domain.requests)} requests · {size(node.domain.measured ? node.domain.bytes : null)}</span></div>}
      </div>
    })}
    <span className="software-badge" title="Software renderer is active because WebGL 2 is unavailable">Software 3D</span>
  </div>
}
