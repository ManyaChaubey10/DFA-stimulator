import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, CircleHelp, CirclePlay, Download, Pause, Play, Plus, RotateCcw, SkipBack, SkipForward, Trash2, Undo2, Redo2, Upload, X } from 'lucide-react'
import StateDiagram from './StateDiagram.jsx'
import {
  addStudentState, asDfa, createStudentModel, deserializeStudentModel, makeTrace, parseAlphabet, serializeStudentModel,
  removeStudentState, renameStudentState, setModelAlphabet, setStudentTransition,
  validateStudentDfa,
} from './studentDfa.js'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

async function responseBody(response) {
  const text = await response.text()
  try { return text ? JSON.parse(text) : {} }
  catch { return { detail: text.slice(0, 300) || `HTTP ${response.status}` } }
}

function apiError(response, body) {
  if (response.status === 404) return `DFA API route not found (${response.url}, HTTP 404). Restart the FastAPI development server and check its registered routes.`
  if (response.status === 422) return body.detail || 'The backend could not validate this request (HTTP 422).'
  return body.detail || `The DFA API returned HTTP ${response.status}.`
}

function EditHistory({ history, undo, redo }) {
  return <div className="student-history">
    <button className="copy-button" onClick={undo} disabled={!history.past.length} title="Undo"><Undo2 size={14}/> Undo</button>
    <button className="copy-button" onClick={redo} disabled={!history.future.length} title="Redo"><Redo2 size={14}/> Redo</button>
  </div>
}

export default function StudentDfaWorkbench() {
  const [history, setHistory] = useState(() => ({ present: createStudentModel(), past: [], future: [] }))
  const [renameDrafts, setRenameDrafts] = useState({})
  const [edgeSymbol, setEdgeSymbol] = useState('0')
  const [editorError, setEditorError] = useState('')
  const [testInput, setTestInput] = useState('')
  const [trace, setTrace] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [verification, setVerification] = useState(null)
  const [checking, setChecking] = useState(false)
  const intervalRef = useRef(null)
  const fileInputRef = useRef(null)
  const model = history.present
  const dfa = useMemo(() => asDfa(model), [model])
  const structuralErrors = useMemo(() => validateStudentDfa(dfa), [dfa])
  const machineKey = JSON.stringify([model.states, model.alphabet, model.transitions, model.start_state, model.accepting_states])
  const questionKey = `${model.mode}|${model.mode === 'regex' ? model.expression : model.description}`
  const canSimulate = structuralErrors.length === 0
  const currentStep = trace?.steps[stepIndex]
  const complete = Boolean(trace && stepIndex >= trace.steps.length - 1)
  const activeSymbol = currentStep && stepIndex < trace.steps.length - 1 ? trace.steps[stepIndex + 1]?.symbol : ''
  const displaySimulation = trace && currentStep ? {
    current_state: currentStep.to_state,
    active_transition: stepIndex > 0 ? currentStep : null,
  } : null

  function commit(transform) {
    setHistory(previous => {
      const next = transform(previous.present)
      if (next === previous.present) return previous
      return { present: next, past: [...previous.past, previous.present].slice(-60), future: [] }
    })
  }

  function patch(patchValue) { commit(current => ({ ...current, ...patchValue })) }
  function undo() {
    setHistory(current => {
      if (!current.past.length) return current
      const previous = current.past[current.past.length - 1]
      return { present: previous, past: current.past.slice(0, -1), future: [current.present, ...current.future] }
    })
  }
  function redo() {
    setHistory(current => {
      if (!current.future.length) return current
      const [next, ...future] = current.future
      return { present: next, past: [...current.past, current.present].slice(-60), future }
    })
  }

  function saveDfa() {
    const contents = JSON.stringify(serializeStudentModel(model), null, 2)
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'dfa-studio-student-dfa.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function loadDfaFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const saved = JSON.parse(await file.text())
      const restored = deserializeStudentModel(saved, model)
      setHistory(current => ({ present: restored, past: [...current.past, current.present].slice(-60), future: [] }))
      setRenameDrafts({})
      setEditorError('')
    } catch (error) {
      setEditorError(`Could not load DFA: ${error.message}`)
    } finally {
      event.target.value = ''
    }
  }

  useEffect(() => {
    setPlaying(false)
    setTrace(null)
    setStepIndex(0)
    setVerification(null)
    setEditorError('')
    if (intervalRef.current) clearInterval(intervalRef.current)
  }, [machineKey])

  useEffect(() => { setVerification(null) }, [questionKey])

  useEffect(() => {
    if (!model.alphabet.includes(edgeSymbol)) setEdgeSymbol(model.alphabet[0] || '')
  }, [model.alphabet, edgeSymbol])

  useEffect(() => {
    if (!playing || !trace) return undefined
    intervalRef.current = setInterval(() => {
      setStepIndex(index => Math.min(index + 1, trace.steps.length - 1))
    }, 850 / speed)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [playing, trace, speed])

  useEffect(() => {
    if (trace && stepIndex >= trace.steps.length - 1) setPlaying(false)
  }, [trace, stepIndex])

  function changeAlphabet(value) {
    commit(current => setModelAlphabet(current, value))
    const symbols = parseAlphabet(value)
    if (!symbols.includes(edgeSymbol)) setEdgeSymbol(symbols[0] || '')
  }

  function setAccepting(state, checked) {
    const accepting = checked
      ? [...model.accepting_states, state]
      : model.accepting_states.filter(value => value !== state)
    patch({ accepting_states: accepting })
  }

  function handleConnect(connection) {
    if (!connection.source || !connection.target || !edgeSymbol) return
    commit(current => setStudentTransition(current, connection.source, edgeSymbol, connection.target))
    setEditorError('')
  }

  function handleNodeDragStop(_event, node) {
    patch({ positions: { ...model.positions, [node.id]: node.position } })
  }

  function runString(value = testInput) {
    if (!canSimulate) {
      setEditorError(`Complete the DFA before simulating: ${structuralErrors[0]}`)
      return
    }
    try {
      const result = makeTrace(dfa, value)
      setTestInput(value)
      setTrace(result)
      setStepIndex(0)
      setPlaying(result.steps.length > 1)
      setEditorError('')
    } catch (error) { setEditorError(error.message) }
  }

  function resetTrace() { setPlaying(false); setStepIndex(0) }
  function nextStep() { setPlaying(false); setStepIndex(index => Math.min(index + 1, (trace?.steps.length || 1) - 1)) }
  function previousStep() { setPlaying(false); setStepIndex(index => Math.max(0, index - 1)) }

  async function checkDfa() {
    if (structuralErrors.length) {
      setVerification({ available: false, message: `Your DFA is incomplete or invalid: ${structuralErrors[0]}`, structural: true })
      return
    }
    if (model.mode === 'regex' && !model.expression.trim()) {
      setVerification({ available: false, message: 'Enter the regular-expression question first.' })
      return
    }
    if (model.mode === 'natural' && !model.description.trim()) {
      setVerification({ available: false, message: 'Enter the plain-English language question first.' })
      return
    }
    setChecking(true)
    setVerification(null)
    try {
      const response = await fetch(`${API}/api/check`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: model.mode, alphabet: model.alphabet,
          expression: model.mode === 'regex' ? model.expression : undefined,
          description: model.mode === 'natural' ? model.description : undefined,
          dfa,
        }),
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(apiError(response, body))
      setVerification(body)
    } catch (error) {
      setVerification({ available: false, message: error.message === 'Failed to fetch'
        ? `Could not reach ${new URL(`${API}/api/check`, window.location.origin).href}. Check that FastAPI is running.`
        : error.message })
    } finally { setChecking(false) }
  }

  const stateDiagram = { ...dfa, complete: canSimulate }
  const consumed = trace ? [...trace.input].slice(0, stepIndex).join('') : ''
  const remaining = trace ? [...trace.input].slice(stepIndex).join('') : testInput
  const displayedResult = verification?.available && !verification.equivalent ? verification : null

  return <div className="student-page">
    <header className="student-heading">
      <div><div className="eyebrow"><span className="eyebrow-line"/>STUDENT AUTOMATA WORKBENCH</div><h1>Build your DFA. <span>Prove it.</span></h1><p className="subtitle">Describe the language, construct your own machine, then check it formally.</p></div>
      <div className="student-header-actions"><EditHistory history={history} undo={undo} redo={redo}/>
        <button className="copy-button" onClick={saveDfa} title="Save your DFA as JSON"><Download size={14}/> Save DFA</button>
        <button className="copy-button" onClick={() => fileInputRef.current?.click()} title="Load a saved DFA JSON"><Upload size={14}/> Load DFA</button>
        <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={loadDfaFile} hidden />
      </div>
    </header>

    <section className="student-layout">
      <aside className="panel student-input-panel">
        <section className="student-section"><div className="student-section-heading"><span className="section-number">01</span><div><h2>Language question</h2><p>Use this only as the reference for checking your solution.</p></div></div>
          <div className="input-mode-toggle" role="tablist" aria-label="Question format"><button className={model.mode === 'natural' ? 'selected' : ''} onClick={() => patch({ mode: 'natural' })}>Plain English</button><button className={model.mode === 'regex' ? 'selected' : ''} onClick={() => patch({ mode: 'regex' })}>Regular Expression</button></div>
          {model.mode === 'natural'
            ? <textarea className="student-question" aria-label="Plain-English language question" value={model.description} onChange={event => patch({ description: event.target.value })} placeholder="Strings ending with 01" />
            : <input className="student-question mono-input" aria-label="Regular-expression language question" value={model.expression} onChange={event => patch({ expression: event.target.value })} placeholder="(0|1)*01" />}
        </section>

        <section className="student-section"><div className="student-section-heading"><span className="section-number">02</span><div><h2>Input alphabet</h2><p>Comma-separated, single-character tokens.</p></div></div>
          <input className="student-question mono-input" aria-label="Input alphabet" value={model.alphabetInput} onChange={event => changeAlphabet(event.target.value)} placeholder="0, 1 or a, b, c" />
          <p className="student-muted">Current Σ: {model.alphabet.length ? `{ ${model.alphabet.join(', ')} }` : 'empty'}</p>
        </section>

        <section className="student-section"><div className="student-section-heading"><span className="section-number">03</span><div><h2>Your DFA states</h2><p>Rename states, choose q₀, and mark accepting states.</p></div></div>
          <label className="student-field-label" htmlFor="initial-state">INITIAL STATE q₀</label>
          <select id="initial-state" className="student-select" value={model.start_state} onChange={event => patch({ start_state: event.target.value })}>
            <option value="">Choose initial state</option>{model.states.map(state => <option key={state} value={state}>{state}</option>)}
          </select>
          <div className="student-state-list">{model.states.map(state => <div className="student-state-row" key={state}>
            <input aria-label={`Rename ${state}`} value={renameDrafts[state] ?? state} onChange={event => setRenameDrafts(current => ({ ...current, [state]: event.target.value }))} onBlur={() => {
              const nextName = renameDrafts[state]
              if (nextName === undefined) return
              try { commit(current => renameStudentState(current, state, nextName)); setRenameDrafts(current => { const next = { ...current }; delete next[state]; return next }) }
              catch (error) { setEditorError(error.message); setRenameDrafts(current => { const next = { ...current }; delete next[state]; return next }) }
            }} />
            <label className="accept-check"><input type="checkbox" checked={model.accepting_states.includes(state)} onChange={event => setAccepting(state, event.target.checked)}/><span>Final</span></label>
            <button className="icon-button small danger-icon" title={`Delete state ${state}`} disabled={model.states.length === 1} onClick={() => commit(current => removeStudentState(current, state))}><Trash2 size={14}/></button>
          </div>)}</div>
          <button className="student-add-button" onClick={() => commit(addStudentState)}><Plus size={14}/> Add state</button>
        </section>
      </aside>

      <div className="student-main-column">
        <section className="panel student-canvas-panel"><div className="student-panel-head"><div className="title-icon blue"><ActivityIcon/></div><div><h2>Construct your DFA</h2><span className="panel-kicker">DRAG STATES · CONNECT TRANSITIONS</span></div><div className="symbol-picker"><label htmlFor="edge-symbol">DRAW ON</label><select id="edge-symbol" value={edgeSymbol} onChange={event => setEdgeSymbol(event.target.value)}>{model.alphabet.map(symbol => <option key={symbol}>{symbol}</option>)}</select></div></div>
          <p className="canvas-instruction">Drag between state handles to draw a transition using the selected symbol. Edit or remove individual transitions in the table below.</p>
          <div className="student-canvas">{model.states.length ? <StateDiagram dfa={stateDiagram} simulation={displaySimulation} editable positions={model.positions} onConnect={handleConnect} onNodeDragStop={handleNodeDragStop}/> : <div className="student-empty-canvas">Add a state to begin constructing your DFA.</div>}</div>
          {editorError && <div className="error-banner student-error"><X size={15}/><span>{editorError}</span></div>}
        </section>

        <section className="panel student-table-panel"><div className="student-panel-head"><div className="title-icon violet"><TableIcon/></div><div><h2>Five-tuple and transition table</h2><span className="panel-kicker">SYNCHRONIZED WITH YOUR DFA</span></div></div>
          <div className="student-tuple"><span>M = (Q, Σ, δ, q₀, F)</span><span>Q = {'{'} {model.states.join(', ') || '∅'} {'}'}</span><span>Σ = {'{'} {model.alphabet.join(', ') || '∅'} {'}'}</span><span>q₀ = {model.start_state || 'unset'}</span><span>F = {'{'} {model.accepting_states.join(', ') || '∅'} {'}'}</span></div>
          <div className="table-scroll student-table-scroll"><table className="transition-table student-transition-table"><thead><tr><th>STATE</th>{model.alphabet.map(symbol => <th key={symbol}>ON <code>{symbol}</code></th>)}</tr></thead><tbody>
            {model.states.map(state => <tr key={state} className={model.accepting_states.includes(state) ? 'accept-row' : ''}><td><span className="table-state">{state}</span>{model.start_state === state && <span className="tiny-start">START</span>}{model.accepting_states.includes(state) && <span className="tiny-accept">FINAL</span>}</td>
              {model.alphabet.map(symbol => <td key={symbol}><select aria-label={`δ(${state}, ${symbol})`} className={`transition-editor${model.transitions[state]?.[symbol] ? '' : ' missing'}`} value={model.transitions[state]?.[symbol] || ''} onChange={event => commit(current => setStudentTransition(current, state, symbol, event.target.value))}><option value="">Choose state…</option>{model.states.map(destination => <option key={destination} value={destination}>{destination}</option>)}</select></td>)}
            </tr>)}
          </tbody></table></div>
          <div className="student-completeness">{canSimulate ? <><Check size={14}/> Complete deterministic transition function</> : <><CircleHelp size={14}/>{structuralErrors.length} item{structuralErrors.length === 1 ? '' : 's'} to complete before simulation/checking</>}</div>
        </section>
      </div>
    </section>

    <section className="panel student-simulator-panel"><div className="student-panel-head"><div className="title-icon green"><Play size={15}/></div><div><h2>Animated string simulator</h2><span className="panel-kicker">STEPS THROUGH YOUR DFA</span></div></div>
      <div className="student-simulator-controls"><label htmlFor="student-test-input">TEST STRING</label><div className="sim-input-wrap"><span className="sim-prefix">ω =</span><input id="student-test-input" value={testInput} onChange={event => setTestInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') runString() }} placeholder="Enter a string (empty is allowed)"/><button className="run-button" onClick={() => runString()} disabled={!canSimulate}><Play size={13} fill="currentColor"/> Run</button></div>
        <div className="player-controls"><button onClick={resetTrace} disabled={!trace} title="Reset"><RotateCcw size={14}/></button><button onClick={previousStep} disabled={!trace || stepIndex === 0} title="Previous step"><SkipBack size={14}/></button><button onClick={() => setPlaying(value => !value)} disabled={!trace || complete} title={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button><button onClick={nextStep} disabled={!trace || complete} title="Next step"><SkipForward size={14}/></button><label htmlFor="playback-speed">Speed</label><select id="playback-speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></div>
      </div>
      {trace && <div className="student-trace-panel"><div className="trace-progress"><span>Current state: <b>{currentStep?.to_state}</b></span><span>Next input: <code className={activeSymbol ? 'active-input-symbol' : ''}>{activeSymbol || '—'}</code></span><span>Consumed: <code>{consumed || 'ε'}</code></span><span>Remaining: <code>{remaining || 'ε'}</code></span>{complete && <strong className={trace.accepted ? 'trace-accepted' : 'trace-rejected'}>{trace.accepted ? 'ACCEPTED' : 'REJECTED'}</strong>}</div>
        <div className="trace-list">{trace.steps.map((step, index) => <div key={`${step.index}-${step.symbol}`} className={`trace-step${index === stepIndex ? ' current' : ''}`}><span>{index === 0 ? 'START' : `STEP ${index}`}</span>{index > 0 && <code>{step.symbol}</code>}<b>{step.to_state}</b><small>{step.note}</small></div>)}</div>
      </div>}
    </section>

    <section className="panel student-check-panel"><div className="student-check-head"><div><div className="student-panel-head"><div className="title-icon violet"><Check size={15}/></div><div><h2>Check My DFA</h2><span className="panel-kicker">LANGUAGE EQUIVALENCE, NOT STATE-COUNT MATCHING</span></div></div><p>The checker validates your transition function, then searches the product automaton for a shortest counterexample.</p></div><button className="generate-button student-check-button" onClick={checkDfa} disabled={checking}><CirclePlay size={15}/>{checking ? 'Checking…' : 'Check My DFA'}<ArrowRight size={15}/></button></div>
      {verification && <div className={`verification-result${!verification.available ? ' unavailable' : verification.equivalent ? ' correct' : ' incorrect'}`}><strong>{!verification.available ? 'Verification unavailable' : verification.equivalent ? 'Your DFA is correct' : 'Your DFA is incorrect'}</strong><span>{verification.message}</span>
        {displayedResult && <><div className="counterexample-line"><span>Shortest counterexample</span><code>{displayedResult.counterexample === '' ? 'ε (empty string)' : displayedResult.counterexample}</code><span>Expected: <b>{displayedResult.expected_result.accepted ? 'accepted' : 'rejected'}</b></span><span>Your DFA: <b>{displayedResult.student_result.accepted ? 'accepted' : 'rejected'}</b></span><button className="copy-button" onClick={() => runString(displayedResult.counterexample)}><Play size={13}/> Replay counterexample</button></div>
          <div className="trace-list verification-trace">{displayedResult.student_result.steps.map((step, index) => <div className="trace-step" key={`${index}-${step.symbol}`}><span>{index === 0 ? 'START' : `STEP ${index}`}</span>{index > 0 && <code>{step.symbol}</code>}<b>{step.to_state}</b><small>{step.note}</small></div>)}</div>
        </>}
      </div>}
    </section>
  </div>
}

function ActivityIcon() { return <CirclePlay size={16}/> }
function TableIcon() { return <span aria-hidden="true">δ</span> }
