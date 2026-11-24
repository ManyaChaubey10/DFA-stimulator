import { useEffect, useMemo } from 'react'
import dagre from '@dagrejs/dagre'
import { assertTransitionEdgesMatchDfa, transitionEdgesFromDfa } from './dfaGraph.js'
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

const NODE_WIDTH = 82
const NODE_HEIGHT = 82

function DfaStateNode({ data }) {
  return (
    <div className={`dfa-state-node${data.start ? ' is-start' : ''}${data.accepting ? ' is-accepting' : ''}${data.current ? ' is-current' : ''}`}>
      <Handle id="in-left" type="target" position={Position.Left} />
      <Handle id="out-left" type="source" position={Position.Left} />
      <Handle id="in-right" type="target" position={Position.Right} />
      <Handle id="out-right" type="source" position={Position.Right} />
      <Handle id="in-top" type="target" position={Position.Top} style={{ left: '33%' }} />
      <Handle id="out-top" type="source" position={Position.Top} style={{ left: '67%' }} />
      <Handle id="in-bottom" type="target" position={Position.Bottom} style={{ left: '33%' }} />
      <Handle id="out-bottom" type="source" position={Position.Bottom} style={{ left: '67%' }} />
      <span className="dfa-start-arrow" aria-hidden="true" />
      <span className="dfa-state-ring"><span>{data.label}</span></span>
      {data.start && <span className="dfa-start-tag">START</span>}
      {data.accepting && <span className="dfa-final-tag">FINAL</span>}
    </div>
  )
}

function DfaEdge({ id, sourceX, sourceY, targetX, targetY, data, style, markerEnd }) {
  let path
  let labelX
  let labelY
  if (data.loop) {
    const lift = 60 + data.loopIndex * 32
    const side = data.loopIndex % 2 === 0 ? 1 : -1
    path = `M ${sourceX} ${sourceY} C ${sourceX + side * 25} ${sourceY - lift}, ${targetX - side * 25} ${targetY - lift}, ${targetX} ${targetY}`
    labelX = (sourceX + targetX) / 2 + side * 10
    labelY = Math.min(sourceY, targetY) - lift + 12
  } else {
    const dx = targetX - sourceX
    const dy = targetY - sourceY
    const length = Math.max(1, Math.hypot(dx, dy))
    const normalX = -dy / length
    const normalY = dx / length
    const offset = data.curveOffset || 0
    const c1x = sourceX + dx * 0.34 + normalX * offset
    const c1y = sourceY + dy * 0.34 + normalY * offset
    const c2x = sourceX + dx * 0.66 + normalX * offset
    const c2y = sourceY + dy * 0.66 + normalY * offset
    path = `M ${sourceX} ${sourceY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${targetX} ${targetY}`
    labelX = (sourceX + targetX) / 2 + normalX * offset * 0.72
    labelY = (sourceY + targetY) / 2 + normalY * offset * 0.72 - 10
  }

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {data.active && <circle r="4" fill="#7058e8" pointerEvents="none">
        <animateMotion dur="0.72s" repeatCount="1" path={path}/>
      </circle>}
      <EdgeLabelRenderer>
        <div
          className={`dfa-edge-label${data.active ? ' is-active' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
        >
          {data.label}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

const nodeTypes = { dfaState: DfaStateNode }
const edgeTypes = { dfaTransition: DfaEdge }

function buildFlow(dfa, simulation, editable, positions) {
  const graph = new dagre.graphlib.Graph({ multigraph: true })
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'LR', ranksep: 148, nodesep: 112, edgesep: 56, marginx: 70, marginy: 76 })

  for (const state of dfa.states) graph.setNode(state, { width: NODE_WIDTH, height: NODE_HEIGHT })

  // Each table cell becomes one graph edge: (source, symbol, destination).
  // Never collapse edges just because they share endpoints.
  const transitionRecords = transitionEdgesFromDfa(dfa, { allowPartial: editable })
  const pairCounts = new Map()
  const pairIndexes = new Map()
  const loopCounts = new Map()
  const loopIndexes = new Map()
  for (const edge of transitionRecords) {
    const pair = JSON.stringify([edge.source, edge.target])
    pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1)
    const indexKey = edge.id
    pairIndexes.set(indexKey, (pairCounts.get(pair) || 1) - 1)
    if (edge.source === edge.target) {
      loopCounts.set(edge.source, (loopCounts.get(edge.source) || 0) + 1)
      loopIndexes.set(indexKey, (loopCounts.get(edge.source) || 1) - 1)
    }
  }
  const directedPairs = new Set(transitionRecords.map(edge => JSON.stringify([edge.source, edge.target])))
  const activeEdges = simulation?.active_transition
    ? new Set([JSON.stringify([simulation.active_transition.from_state, simulation.active_transition.symbol, simulation.active_transition.to_state])])
    : new Set((simulation?.steps || []).slice(1).map(step => JSON.stringify([step.from_state, step.symbol, step.to_state])))

  for (const edge of transitionRecords) {
    graph.setEdge(edge.source, edge.target, { width: Math.max(42, edge.data.label.length * 10), height: 24 }, edge.id)
  }
  dagre.layout(graph)

  const nodes = dfa.states.map(state => {
    const point = graph.node(state)
    return {
      id: state,
      type: 'dfaState',
      position: positions?.[state] || { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 },
      data: {
        label: state,
        start: state === dfa.start_state,
        accepting: dfa.accepting_states.includes(state),
        current: (simulation?.current_state ?? simulation?.final_state) === state,
      },
    }
  })

  const edges = transitionRecords.map(edge => {
    const sourcePoint = graph.node(edge.source)
    const targetPoint = graph.node(edge.target)
    const horizontal = Math.abs(targetPoint.x - sourcePoint.x) >= Math.abs(targetPoint.y - sourcePoint.y)
    let sourceHandle
    let targetHandle
    if (edge.source === edge.target) {
      sourceHandle = 'out-top'
      targetHandle = 'in-top'
    } else if (horizontal) {
      sourceHandle = targetPoint.x >= sourcePoint.x ? 'out-right' : 'out-left'
      targetHandle = targetPoint.x >= sourcePoint.x ? 'in-left' : 'in-right'
    } else {
      sourceHandle = targetPoint.y >= sourcePoint.y ? 'out-bottom' : 'out-top'
      targetHandle = targetPoint.y >= sourcePoint.y ? 'in-top' : 'in-bottom'
    }

    const pair = JSON.stringify([edge.source, edge.target])
    const reversePair = JSON.stringify([edge.target, edge.source])
    const parallelCount = pairCounts.get(pair)
    const parallelIndex = pairIndexes.get(edge.id)
    const parallelOffset = (parallelIndex - (parallelCount - 1) / 2) * 42
    // The normal vector reverses with a reciprocal edge. Use the same signed
    // offset in both directions so the two paths bend to opposite visual sides.
    const reciprocalOffset = edge.source !== edge.target && directedPairs.has(reversePair) ? 42 : 0

    return {
      ...edge,
      sourceHandle,
      targetHandle,
      type: 'dfaTransition',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#9ba5b6', width: 17, height: 17 },
      data: {
        ...edge.data,
        loop: edge.source === edge.target,
        loopIndex: loopIndexes.get(edge.id) || 0,
        loopCount: loopCounts.get(edge.source) || 0,
        curveOffset: edge.source === edge.target ? 0 : parallelOffset + reciprocalOffset,
        active: activeEdges.has(JSON.stringify([edge.source, edge.data.symbol, edge.target])),
      },
      style: { stroke: '#a3adbc', strokeWidth: 1.7 },
    }
  })

  if (!editable) assertTransitionEdgesMatchDfa(dfa, edges)
  return { nodes, edges }
}

export default function StateDiagram({ dfa, simulation, editable = false, positions, onConnect, onNodeDragStop }) {
  const { nodes: generatedNodes, edges } = useMemo(() => buildFlow(dfa, simulation, editable, positions), [dfa, simulation, editable, positions])
  const [nodes, setNodes, onNodesChange] = useNodesState(generatedNodes)
  useEffect(() => setNodes(generatedNodes), [generatedNodes, setNodes])
  const flowKey = `${dfa.expression}-${dfa.states.join(',')}-${JSON.stringify(dfa.transitions)}`

  return (
    <div className="diagram-flow">
      <ReactFlow
        key={flowKey}
        className="dfa-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1.12 }}
        minZoom={0.18}
        maxZoom={2.2}
        panOnDrag
        zoomOnScroll
        nodesDraggable={editable}
        nodesConnectable={editable}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        elementsSelectable={editable}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e6e8f0" />
        <Controls showInteractive={false} fitViewOptions={{ padding: 0.22 }} />
        {dfa.states.length > 7 && <MiniMap pannable zoomable nodeColor={node => node.data.accepting ? '#60b99a' : '#c5b9fa'} />}
      </ReactFlow>
    </div>
  )
}
