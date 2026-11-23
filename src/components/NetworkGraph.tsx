import { Billboard, Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Component, memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { Minus, Plus, RotateCcw, Waypoints } from 'lucide-react'
import { AdditiveBlending, Color, Matrix4, PerspectiveCamera, QuadraticBezierCurve3, Vector3 } from 'three'
import type { Group, InstancedMesh } from 'three'
import type { Capture } from '../lib/model'
import { count, size } from '../lib/format'
import { GROUPED_COLOR, nodeRadius, OTHER_DOMAINS, type GraphNode } from '../lib/topology'
import { CAMERA, ORIGIN, SoftwareTopology, type GraphMetric, type CameraCommand } from './SoftwareTopology'

const CYAN = '#54daf5'
const VIOLET = '#ad82ff'
const GL_OPTIONS = { alpha: true, antialias: true, powerPreference: 'low-power' } as const
const SEGMENT_INDICES = new Uint16Array(Array.from({ length: 52 }, (_, step) => Math.floor((step + 1) / 2)))
const noRaycast = () => {}
let webGLSupported: boolean | null = null

function supportsWebGL() {
  if (webGLSupported !== null) return webGLSupported
  try {
    const gl = document.createElement('canvas').getContext('webgl2', GL_OPTIONS) as WebGL2RenderingContext | null
    webGLSupported = gl !== null
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webGLSupported = false
  }
  return webGLSupported
}

const haloVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const haloFragment = `
  varying vec2 vUv;
  uniform vec3 tint;
  uniform float opacity;
  void main() {
    float radius = length(vUv - .5) * 2.;
    float glow = exp(-radius * radius * 7.) * (1. - smoothstep(.55, 1., radius));
    gl_FragColor = vec4(tint, glow * opacity);
    #include <colorspace_fragment>
  }
`
const orbVertex = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`
const orbFragment = `
  varying vec3 vNormal;
  varying vec3 vView;
  uniform vec3 tint;
  void main() {
    vec3 normal = normalize(vNormal);
    float edge = pow(1. - max(0., dot(normal, normalize(vView))), 2.1);
    float light = max(0., dot(normal, normalize(vec3(-.45, .7, .7))));
    vec3 color = tint * (.19 + light * .46 + edge * .88);
    color = mix(color, vec3(.83, .95, 1.), pow(light, 12.) * .48 + edge * .16);
    gl_FragColor = vec4(color, 1.);
    #include <colorspace_fragment>
  }
`

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

const Orb = memo(function Orb({ node, radius, selected, related, showLabel, hiddenLabel, reduced, portal, onSelect }: {
  node: GraphNode
  radius: number
  selected: boolean
  related: boolean
  showLabel: boolean
  hiddenLabel: string
  reduced: boolean
  portal: { current: HTMLDivElement }
  onSelect: (name: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [labelFocused, setLabelFocused] = useState(false)
  const leaveTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)
  const highlighted = selected || related
  const focus = highlighted || hovered || labelFocused
  const capture = node.domain
  const name = node.grouped ? hiddenLabel : capture.name
  const color = node.grouped ? GROUPED_COLOR : capture.firstParty ? CYAN : VIOLET
  const visual = useRef<Group>(null)
  const progress = useRef(reduced ? 1 : 0.04)
  const haloUniforms = useMemo(() => ({ tint: { value: new Color(color) }, opacity: { value: focus ? 0.70 : node.root ? 0.55 : 0.45 } }), [color, focus, node.root])
  const sphereUniforms = useMemo(() => ({ tint: { value: new Color(color) } }), [color])
  useFrame((_, delta) => {
    if (!visual.current) return
    const target = hovered ? 1.12 : 1
    progress.current = reduced ? target : progress.current + (target - progress.current) * (1 - Math.exp(-Math.min(delta, 0.1) * 8))
    visual.current.scale.setScalar(progress.current)
  })
  useEffect(() => () => clearTimeout(leaveTimeout.current), [])

  function enter() {
    clearTimeout(leaveTimeout.current)
    setHovered(true)
  }

  function leave() {
    clearTimeout(leaveTimeout.current)
    // Let the pointer cross the gap between an orb and its label.
    leaveTimeout.current = setTimeout(() => setHovered(false), 170)
  }

  function select(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    if (event.delta <= 4) onSelect(capture.name)
  }

  return <group position={node.position}>
    <group ref={visual} scale={progress.current}>
      <Billboard>
        <mesh raycast={noRaycast}>
          <planeGeometry args={[radius * 6.4, radius * 6.4]} />
          <shaderMaterial uniforms={haloUniforms} vertexShader={haloVertex} fragmentShader={haloFragment}
            blending={AdditiveBlending} depthWrite={false} transparent />
        </mesh>
      </Billboard>
      <mesh onClick={select}
        onPointerOver={(event) => { event.stopPropagation(); enter() }}
        onPointerOut={leave}>
        <icosahedronGeometry args={[radius, node.root ? 4 : 3]} />
        <shaderMaterial uniforms={sphereUniforms} vertexShader={orbVertex} fragmentShader={orbFragment} />
      </mesh>
      {node.root && <mesh raycast={noRaycast}>
        <icosahedronGeometry args={[radius * 1.016, 2]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.13} depthWrite={false} />
      </mesh>}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} raycast={noRaycast}>
        <ringGeometry args={[radius * 1.52, radius * 1.55, 64]} />
        <meshBasicMaterial color={color} transparent opacity={focus ? 0.72 : 0.44} side={2} depthWrite={false} />
      </mesh>
      {(node.root || focus) && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} raycast={noRaycast}>
        <ringGeometry args={[radius * 1.87, radius * 1.90, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.24} side={2} depthWrite={false} />
      </mesh>}
    </group>
    {(showLabel || focus) && <Html portal={portal} position={[0, -radius - 0.13, 0]} center zIndexRange={[6, 1]}>
      <button className={'node-label' + (node.root ? ' node-label-root' : '') + (highlighted ? ' node-label-active' : '')}
        type="button" onClick={() => onSelect(capture.name)} title={name} aria-label={'Inspect domain ' + name} aria-pressed={selected}
        onPointerEnter={enter} onPointerLeave={leave} onFocus={() => setLabelFocused(true)} onBlur={() => setLabelFocused(false)}>{name}</button>
    </Html>}
    {(hovered || labelFocused) && <Html portal={portal} position={[0, radius + 0.37, 0]} center zIndexRange={[9, 8]}>
      <div className="node-tooltip"><strong>{name}</strong><span>{count(capture.requests)} requests · {size(capture.measured ? capture.bytes : null)}</span></div>
    </Html>}
  </group>
})

type Connection = {
  curve: QuadraticBezierCurve3
  color: string
  points: Float32Array
}

function Connections({ nodes, reduced }: { nodes: GraphNode[]; reduced: boolean }) {
  const dots = useRef<InstancedMesh>(null)
  const matrix = useMemo(() => new Matrix4(), [])
  const point = useMemo(() => new Vector3(), [])
  const connections = useMemo<Connection[]>(() => nodes.slice(1).map((node, index) => {
    const start = new Vector3(...nodes[0].position)
    const end = new Vector3(...node.position)
    const bend = start.clone().lerp(end, 0.5).add(new Vector3(0, 0.47 + (index % 3) * 0.12, 0))
    const curve = new QuadraticBezierCurve3(start, bend, end)
    return {
      curve,
      color: node.grouped ? GROUPED_COLOR : node.domain.firstParty ? CYAN : VIOLET,
      points: new Float32Array(curve.getPoints(26).flatMap((value) => value.toArray())),
    }
  }), [nodes])

  useFrame(({ clock }) => {
    if (!dots.current || reduced) return
    const elapsed = clock.getElapsedTime()
    connections.forEach(({ curve }, index) => {
      curve.getPoint((elapsed * (0.18 + (index % 3) * 0.04) + index * 0.31) % 1, point)
      dots.current?.setMatrixAt(index, matrix.makeTranslation(point.x, point.y, point.z))
    })
    dots.current.instanceMatrix.needsUpdate = true
  })

  return <>
    {connections.map((connection, index) => <lineSegments key={nodes[index + 1].domain.name} raycast={noRaycast}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[connection.points, 3]} />
        <bufferAttribute attach="index" args={[SEGMENT_INDICES, 1]} />
      </bufferGeometry>
      <lineBasicMaterial color={connection.color} transparent opacity={0.37} depthWrite={false} />
    </lineSegments>)}
    {!reduced && connections.length > 0 && <instancedMesh ref={dots} args={[undefined, undefined, connections.length]} frustumCulled={false} raycast={noRaycast}>
      <sphereGeometry args={[0.045, 6, 5]} />
      <meshBasicMaterial color="#c2ecff" transparent opacity={0.82} />
    </instancedMesh>}
  </>
}

function Ground() {
  return <group position={[0, -1.24, 0]}>
    <gridHelper args={[28, 36, '#2a3d5b', '#26314d']} raycast={noRaycast}>
      <lineBasicMaterial attach="material" color="#40517a" opacity={0.25} transparent depthWrite={false} />
    </gridHelper>
    {[2.45, 4.67, 6.1].map((radius) => <mesh key={radius} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} raycast={noRaycast}>
      <ringGeometry args={[radius, radius + 0.014, 100]} />
      <meshBasicMaterial color="#53638d" transparent opacity={0.26} side={2} depthWrite={false} />
    </mesh>)}
  </group>
}

function Scene({ nodes, metric, selected, hidden, command, reduced, labelLayer, onSelect }: {
  nodes: GraphNode[]
  metric: GraphMetric
  selected: string | null
  hidden: Set<string>
  command: CameraCommand | null
  reduced: boolean
  labelLayer: HTMLDivElement
  onSelect: (name: string) => void
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const width = useThree((state) => state.size.width)
  const camera = useThree((state) => state.camera)
  const invalidate = useThree((state) => state.invalidate)
  const portal = useMemo(() => ({ current: labelLayer }), [labelLayer])
  const maximum = Math.max(1, ...nodes.filter((node) => !node.grouped).map(({ domain }) => domain[metric]))
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return
    camera.zoom = Math.min(1, width / 590)
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, width, invalidate])
  useEffect(() => {
    if (!command || !controls.current) return
    const control = controls.current
    if (command.action === 'reset') {
      camera.position.set(...CAMERA)
      control.target.set(...ORIGIN)
    } else {
      const offset = camera.position.clone().sub(control.target)
      const length = Math.max(control.minDistance, Math.min(control.maxDistance, offset.length() * (command.action === 'in' ? 0.80 : 1.25)))
      camera.position.copy(control.target).add(offset.setLength(length))
    }
    control.update()
    invalidate()
  }, [camera, command, invalidate])

  return <>
    <fog attach="fog" args={['#0c101e', 13, 31]} />
    <Ground />
    <Connections nodes={nodes} reduced={reduced} />
    {nodes.map((node, index) => <Orb key={node.domain.name} node={node}
      radius={nodeRadius(node, metric, maximum)}
      showLabel={node.grouped || index < (width < 460 ? 3 : 10)}
      selected={selected === node.domain.name} related={Boolean(node.grouped && selected && hidden.has(selected))}
      hiddenLabel={count(hidden.size) + ' more domains'} reduced={reduced} portal={portal} onSelect={onSelect} />)}
    <OrbitControls ref={controls} makeDefault target={ORIGIN} minDistance={4.5} maxDistance={28}
      maxPolarAngle={Math.PI * 0.49} enableDamping={!reduced} dampingFactor={0.12} />
  </>
}

function GraphFallback() {
  return <div className="graph-message"><Waypoints size={28} /><strong>3D view unavailable</strong><span>You can still inspect every hostname in Domains.</span></div>
}

class GraphBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export default memo(function NetworkGraph({ capture, nodes, hidden, selected, onSelect }: {
  capture: Capture
  nodes: GraphNode[]
  hidden: Set<string>
  selected: string | null
  onSelect: (name: string) => void
}) {
  const [metric, setMetric] = useState<GraphMetric>('requests')
  const [command, setCommand] = useState<CameraCommand | null>(null)
  const reduced = useReducedMotion()
  const stage = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [labelLayer, setLabelLayer] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (nodes.length) setAvailable(supportsWebGL())
  }, [nodes.length])
  useEffect(() => {
    if (!stage.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])
  const watchCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return
    const contextLost = () => setAvailable(false)
    canvas.addEventListener('webglcontextlost', contextLost)
    return () => canvas.removeEventListener('webglcontextlost', contextLost)
  }, [])

  const fallback = <SoftwareTopology nodes={nodes} metric={metric} selected={selected} hidden={hidden} command={command} onSelect={onSelect} />

  return <section className="panel graph-panel" aria-labelledby="topology-title">
    <header className="panel-heading">
      <div className="panel-title-with-icon">
        <div className="section-icon graph-icon"><Waypoints size={17} /></div>
        <div><h2 id="topology-title">Network Topology</h2><p>Interactive 3D view of contacted domains</p></div>
      </div>
      <div className="segmented" role="group" aria-label="Size graph nodes by">
        <button type="button" aria-pressed={metric === 'requests'} onClick={() => setMetric('requests')}>Requests</button>
        <button type="button" aria-pressed={metric === 'bytes'} onClick={() => setMetric('bytes')}>Bytes</button>
      </div>
    </header>
    <div className="graph-stage" ref={stage}>
      {nodes.length === 0 ? <div className="graph-message"><Waypoints size={28} /><strong>No domain connections</strong><span>This capture has no requests to map.</span></div>
        : available === null ? <div className="graph-message" role="status">Starting the 3D view…</div> : <>
        {available ? <div ref={setLabelLayer} className="graph-label-layer" /> : null}
        {available === false ? fallback : labelLayer && <GraphBoundary fallback={fallback}>
          <Canvas
            ref={watchCanvas}
            camera={{ position: CAMERA, fov: 34, near: 0.1, far: 55 }}
            dpr={[1, 1.65]}
            gl={GL_OPTIONS}
            frameloop={!visible || reduced ? 'demand' : 'always'}
            fallback={<GraphFallback />}>
            <Scene nodes={nodes} metric={metric} selected={selected} hidden={hidden} reduced={reduced} command={command} labelLayer={labelLayer} onSelect={onSelect} />
          </Canvas>
        </GraphBoundary>}
        <div className="graph-controls" role="group" aria-label="Graph navigation">
          <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => setCommand({ action: 'in' })}><Plus size={17} /></button>
          <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => setCommand({ action: 'out' })}><Minus size={17} /></button>
          <button type="button" className="icon-button" aria-label="Reset camera" title="Reset camera" onClick={() => setCommand({ action: 'reset' })}><RotateCcw size={15} /></button>
        </div>
        <div className="graph-root" title={capture.mainDomain ?? undefined}><i />{capture.mainDomain}</div>
      </>}
    </div>
    <footer className="graph-footer">
      <div className="graph-legend">
        <span><i className="first-party" /> First-party</span><span><i className="third-party" /> Third-party</span>
        {hidden.size > 0 && <button className="plain-link grouped-link" type="button" aria-pressed={selected === OTHER_DOMAINS} onClick={() => onSelect(OTHER_DOMAINS)}>
          <i /> {count(hidden.size)} grouped
        </button>}
      </div>
      <span className="graph-hint">{metric === 'bytes' && capture.measured < capture.requests.length ? 'Sizing uses measured bytes' : available === false ? 'Drag to orbit · Use + / − to zoom' : 'Drag to orbit · Scroll to zoom'}</span>
    </footer>
  </section>
})
