import { useEffect, useMemo, useState } from 'react'
import StateDiagram from './StateDiagram.jsx'
import StudentDfaWorkbench from './StudentDfaWorkbench.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { normalizeRoute } from './routes.js'
import { Activity, ArrowDown, ArrowRight, Check, ChevronDown, CircleHelp, Code2, Download, FlaskConical, Github, Info, Play, Plus, RotateCcw, Sparkles, X } from 'lucide-react'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const requiredApiRoutes = ['POST /api/interpret', 'POST /api/dfa', 'POST /api/dfa/natural', 'POST /api/simulate']
const examples = [
  { label: 'Ends with 01', alphabet: '0, 1', expression: '(0|1)*01' },
  { label: 'Even number of 1s', alphabet: '0, 1', expression: '0* (10*10*)*' },
  { label: 'Contains 101', alphabet: '0, 1', expression: '(0|1)*101(0|1)*' },
]
const languageExamples = [
  { label: 'Even number of 0s', description: 'Even number of 0s' },
  { label: 'Odd number of 1s', description: 'Odd number of 1s' },
  { label: 'Ends with 01', description: 'Binary strings ending with 01' },
  { label: 'Contains 101', description: 'Strings containing 101' },
  { label: 'No consecutive 1s', description: 'No consecutive 1s' },
  { label: 'Even 0s and odd 1s', description: 'Even number of 0s and odd number of 1s' },
  { label: 'Second from right is 1', description: 'Second symbol from the right is 1' },
  { label: 'Exactly three 1s', description: 'Strings containing exactly three 1s' },
  { label: 'Length divisible by 3', description: 'Strings whose length is divisible by 3' },
  { label: 'Contains 101, avoids 000', description: 'Strings containing 101 but not 000' },
]

function GeneratorStudio() {
  const [alphabetInput, setAlphabetInput] = useState('0, 1')
  const [expression, setExpression] = useState('(0|1)*01')
  const [inputMode, setInputMode] = useState('regex')
  const [description, setDescription] = useState('Binary strings ending with 01')
  const [interpretedAst, setInterpretedAst] = useState('')
  const [interpretationExplanation, setInterpretationExplanation] = useState('')
  const [interpretationSource, setInterpretationSource] = useState('')
  const [dfa, setDfa] = useState(null)
  const [minimizedDfa, setMinimizedDfa] = useState(null)
  const [viewMode, setViewMode] = useState('original')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [testInput, setTestInput] = useState('1101')
  const [simulation, setSimulation] = useState(null)
  const [activeTab, setActiveTab] = useState('diagram')
  const [copied, setCopied] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const alphabet = useMemo(() => alphabetInput.split(',').map(s=>s.trim()).filter(Boolean), [alphabetInput])
  const activeDfa = viewMode === 'minimized' ? minimizedDfa : dfa

  useEffect(() => {
    let cancelled = false
    fetch(`${API}/health`)
      .then(response => {
        if (!response.ok) throw new Error(`API health check failed (HTTP ${response.status})`)
        return response.json()
      })
      .then(body => {
        const routes = new Set(body.required_routes || [])
        const missing = requiredApiRoutes.filter(route => !routes.has(route))
        if (body.status !== 'ok' || missing.length) throw new Error(`Backend routes unavailable: ${missing.join(', ') || 'health reports degraded'}`)
        if (!cancelled) setApiStatus('online')
      })
      .catch(() => { if (!cancelled) setApiStatus('offline') })
    return () => { cancelled = true }
  }, [])

  function apiFailureMessage(url, method, status, detail) {
    const message = status === 404
      ? `API route not found. The backend may be outdated or the route is not registered${detail ? `: ${detail}` : '.'}`
      : status === 422
        ? `The backend rejected the request (HTTP 422): ${detail || 'check the alphabet and language description.'}`
        : detail || `The backend returned HTTP ${status}.`
    const requestUrl = new URL(url, window.location.origin).href
    return import.meta.env.DEV ? `${message} (${method} ${requestUrl} — HTTP ${status})` : message
  }

  async function readApiResponse(response) {
    const text = await response.text()
    try { return text ? JSON.parse(text) : {} }
    catch { return { detail: text.slice(0, 240) || `HTTP ${response.status}` } }
  }

  async function generate() {
    const natural = inputMode === 'natural'
    const url = `${API}${natural ? '/api/interpret' : '/api/dfa'}`
    const payload = natural ? { alphabet, description } : { alphabet, expression }
    let activeUrl = url
    setLoading(true); setError(''); setSimulation(null)
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await readApiResponse(response)
      if (!response.ok) throw new Error(apiFailureMessage(url, 'POST', response.status, body.detail || 'Could not generate a DFA.'))
      let dfaBody = body
      if (natural) {
        setInterpretedAst(JSON.stringify(body.ast, null, 2))
        setInterpretationExplanation(body.explanation)
        setInterpretationSource(body.source)
        const compileUrl = `${API}/api/dfa/natural`
        activeUrl = compileUrl
        const compiled = await fetch(compileUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alphabet, description, ast: body.ast }) })
        dfaBody = await readApiResponse(compiled)
        if (!compiled.ok) throw new Error(apiFailureMessage(compileUrl, 'POST', compiled.status, dfaBody.detail || 'Could not compile the interpreted constraints.'))
      } else {
        setInterpretedAst(''); setInterpretationExplanation(''); setInterpretationSource('')
      }
      const { minimized_dfa: reduced, ...original } = dfaBody
      setDfa(original); setMinimizedDfa(reduced); setViewMode('original')
    } catch (err) {
      setDfa(null); setMinimizedDfa(null); setViewMode('original')
      setError(err.message === 'Failed to fetch'
        ? (import.meta.env.DEV ? `Could not reach ${new URL(activeUrl, window.location.origin).href} (POST; no HTTP response).` : 'Could not reach the API. Confirm FastAPI is running on port 8000.')
        : err.message)
    } finally { setLoading(false) }
  }

  async function compileEditedAst() {
    const url = `${API}/api/dfa/natural`
    setLoading(true); setError(''); setSimulation(null)
    try {
      let ast
      try { ast = JSON.parse(interpretedAst) } catch { throw new Error('The interpretation preview must be valid JSON before it can be compiled.') }
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alphabet, description, ast }) })
      const body = await readApiResponse(response)
      if (!response.ok) throw new Error(apiFailureMessage(url, 'POST', response.status, body.detail || 'Could not compile the edited constraints.'))
      const { minimized_dfa: reduced, ...original } = body
      setDfa(original); setMinimizedDfa(reduced); setViewMode('original')
      setInterpretationExplanation(body.interpretation_explanation)
      setInterpretationSource('user-edited')
    } catch (err) { setError(err.message === 'Failed to fetch' && import.meta.env.DEV ? `Could not reach ${new URL(url, window.location.origin).href} (POST; no HTTP response).` : err.message) }
    finally { setLoading(false) }
  }

  async function runSimulation() {
    if (!activeDfa) return
    const url = `${API}/api/simulate`
    setError('')
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dfa: activeDfa, input: testInput }) })
      const body = await readApiResponse(response)
      if (!response.ok) throw new Error(apiFailureMessage(url, 'POST', response.status, body.detail || 'Could not simulate this input.'))
      setSimulation(body)
    } catch (err) {
      setSimulation(null)
      setError(err.message === 'Failed to fetch' && import.meta.env.DEV ? `Could not reach ${new URL(url, window.location.origin).href} (POST; no HTTP response).` : err.message)
    }
  }
  async function copyTuple() { if(!activeDfa)return; await navigator.clipboard.writeText(JSON.stringify(activeDfa,null,2)); setCopied(true);setTimeout(()=>setCopied(false),1500) }
  function loadExample(example) { setAlphabetInput(example.alphabet);setExpression(example.expression);setDfa(null);setMinimizedDfa(null);setViewMode('original');setSimulation(null);setError('') }
  function loadLanguageExample(example) { setDescription(example.description);setDfa(null);setMinimizedDfa(null);setViewMode('original');setSimulation(null);setError('') }

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark"><Activity size={17}/></span><span>DFA <b>Studio</b></span></a><div className="topbar-right"><span className="workspace-label"><span className="online-dot"/>AUTOMATA LAB</span><button className="icon-button" title="About DFA Studio" aria-label="About DFA Studio"><CircleHelp size={18}/></button><span className="avatar">M</span></div></header>
    <main className="page"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>FINITE AUTOMATA WORKBENCH</div><h1>Build. Visualize. <span>Understand.</span></h1><p className="subtitle">Turn regexes or plain-English descriptions into deterministic finite automata.</p></div><div className="version-chip"><span className="version-dot"/>DFA GENERATOR <span className="version-sep">·</span> v1.0</div></div>
      <section className="workspace">
        <aside className="panel editor-panel"><div className="panel-title"><div className="title-icon violet"><Code2 size={16}/></div><div><h2>Define your language</h2><span className="panel-kicker">INPUT CONFIGURATION</span></div><span className={`api-health ${apiStatus}`} title={`Backend health: ${apiStatus}`}><i/>API {apiStatus==='checking'?'CHECKING':apiStatus.toUpperCase()}</span><button className="icon-button small" title="Reset to default" onClick={()=>{setAlphabetInput('0, 1');setExpression('(0|1)*01');setDescription('Binary strings ending with 01');setDfa(null);setMinimizedDfa(null);setViewMode('original');setSimulation(null);setError('')}}><RotateCcw size={15}/></button></div>
          <div className="form-field"><label htmlFor="alphabet">INPUT ALPHABET <span className="label-info">Σ</span></label><div className="input-wrap alphabet-wrap"><span className="field-prefix">Σ =</span><input id="alphabet" value={alphabetInput} onChange={e=>setAlphabetInput(e.target.value)} placeholder="0, 1"/><span className="field-status"><Check size={14}/></span></div><p className="field-hint">Comma-separated symbols, e.g. <code>0, 1</code></p></div>
          <div className="input-mode-toggle" role="tablist" aria-label="Language input mode"><button role="tab" aria-selected={inputMode==='regex'} className={inputMode==='regex'?'selected':''} onClick={()=>{setInputMode('regex');setError('')}}>Regular Expression</button><button role="tab" aria-selected={inputMode==='natural'} className={inputMode==='natural'?'selected':''} onClick={()=>{setInputMode('natural');setError('')}}>Plain English</button></div>
          {inputMode==='regex'?<div className="form-field regex-field"><div className="label-row"><label htmlFor="regex">REGULAR EXPRESSION</label><span className="required-badge">REQUIRED</span></div><div className="input-wrap regex-wrap"><span className="field-prefix regex-prefix">ƒ</span><input id="regex" className="mono-input" value={expression} onChange={e=>setExpression(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')generate()}} placeholder="(0|1)*01"/><span className="regex-valid"><span/>VALID SYNTAX</span></div><p className="field-hint">Use <code>|</code> union · <code>*</code> Kleene star · <code>+</code> one or more · <code>?</code> optional · <code>()</code> grouping</p><div className="epsilon-note"><Info size={14}/><span>Also supports <code>ε</code> (empty string) and <code>∅</code> (empty language).</span></div></div>:null}
          {inputMode==='natural'&&<div className="form-field regex-field"><div className="label-row"><label htmlFor="description">PLAIN-ENGLISH DESCRIPTION</label><span className="required-badge">LANGUAGE CONSTRAINTS</span></div><div className="input-wrap regex-wrap"><span className="field-prefix regex-prefix"><Sparkles size={14}/></span><input id="description" value={description} onChange={e=>setDescription(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')generate()}} placeholder="Even number of 0s"/></div><p className="field-hint">Describe counts, positions, patterns, length, or Boolean combinations. Unsupported or unclear requests are rejected.</p><div className="epsilon-note"><Info size={14}/><span>Deterministic interpretation works without credentials. Configure an LLM API key for broader wording.</span></div></div>}
          {inputMode==='natural'&&interpretedAst&&<div className="interpretation-preview"><div className="label-row"><label htmlFor="interpreted-ast">INTERPRETED CONSTRAINTS</label><span className="required-badge">{interpretationSource.toUpperCase()}</span></div><p className="field-hint interpretation-explanation">{interpretationExplanation}</p><textarea id="interpreted-ast" className="ast-editor mono-input" value={interpretedAst} onChange={e=>setInterpretedAst(e.target.value)} spellCheck="false" aria-label="Edit interpreted language AST"/><button className="copy-button recompile-button" onClick={compileEditedAst} disabled={loading}><Check size={14}/> Compile edited interpretation</button></div>}
          <button className="generate-button" onClick={generate} disabled={loading}><Sparkles size={16}/>{loading?'Generating…':'Generate DFA'}<ArrowRight size={16} className="button-arrow"/></button>
          {error&&<div className="error-banner"><X size={15}/><span>{error}</span></div>}
          <div className="examples"><div className="examples-heading"><span>QUICK EXAMPLES</span><span className="examples-line"/><ChevronDown size={13}/></div>{inputMode==='regex'?examples.map((item,i)=><button key={item.label} onClick={()=>loadExample(item)} className="example-item"><span className="example-icon"><Sparkles size={13}/></span><span>{item.label}</span><code>{item.expression}</code></button>):languageExamples.map((item,i)=><button key={item.label} onClick={()=>loadLanguageExample(item)} className="example-item"><span className="example-icon"><Sparkles size={13}/></span><span>{item.label}</span></button>)}</div>
          <div className="syntax-card"><div className="syntax-heading"><span className="syntax-dot"/><span>SUPPORTED SYNTAX</span></div><div className="syntax-list">{inputMode==='regex'?<><span><code>a</code> literal</span><span><code>ab</code> concatenation</span><span><code>a|b</code> union</span><span><code>a*</code> zero or more</span></>:<><span>count and length constraints</span><span>left / right positions</span><span>prefix, suffix, substrings</span><span>AND / OR / NOT</span></>}</div></div>
        </aside>
        <section className="results-column">
          <div className="panel result-panel"><div className="result-header"><div className="panel-title result-title"><div className="title-icon blue"><Activity size={16}/></div><div><h2>State transition diagram</h2><span className="panel-kicker">VISUAL REPRESENTATION</span></div></div><div className="result-actions"><div className="dfa-view-toggle" role="group" aria-label="DFA view"><button className={viewMode==='original'?'selected':''} disabled={!dfa} onClick={()=>{setViewMode('original');setSimulation(null)}}>Generated <b>{dfa?.states.length ?? '?'}</b></button><button className={viewMode==='minimized'?'selected':''} disabled={!minimizedDfa} onClick={()=>{setViewMode('minimized');setSimulation(null)}}>Minimized <b>{minimizedDfa?.states.length ?? '?'}</b></button></div><span className={`result-count ${activeDfa?'ready':''}`}><span className="count-dot"/>{activeDfa?`${activeDfa.states.length} STATES`:'AWAITING INPUT'}</span><button className="icon-button small" title="Export diagram" onClick={()=>window.print()}><Download size={15}/></button></div></div>
            <div className="diagram-area">{activeDfa?<StateDiagram dfa={activeDfa} simulation={simulation}/>:<div className="empty-diagram"><div className="empty-art"><svg viewBox="0 0 160 95" width="160" height="95"><path d="M 22 47 C 22 16, 64 16, 64 47 C 64 78, 22 78, 22 47 M 91 47 C 91 16, 133 16, 133 47 C 133 78, 91 78, 91 47" fill="none" stroke="#e4e5f0" strokeWidth="1.5"/><path d="M64 47 L91 47" stroke="#d0c7f7" strokeWidth="1.5" strokeDasharray="4 4"/><circle cx="43" cy="47" r="11" fill="#fff" stroke="#e1e2ea"/><circle cx="112" cy="47" r="11" fill="#fff" stroke="#e1e2ea"/><circle cx="112" cy="47" r="8" fill="none" stroke="#e1e2ea"/></svg></div><strong>Your automaton will appear here</strong><span>Configure a language and generate your DFA to get started.</span></div>}</div>
            <div className="diagram-legend"><span><i className="legend-start"/>Start state</span><span><i className="legend-accept"/>Accepting state</span><span><i className="legend-edge"/>Transition</span><span className="zoom-label">DRAG TO PAN <span>·</span> FIT TO VIEW</span></div>
          </div>
          <div className="panel details-panel"><div className="tab-bar"><button className={activeTab==='tuple'?'active':''} onClick={()=>setActiveTab('tuple')}><Code2 size={15}/> 5-tuple</button><button className={activeTab==='table'?'active':''} onClick={()=>setActiveTab('table')}><FlaskConical size={15}/> Transition table</button><div className="tab-spacer"/><button className="copy-button" disabled={!activeDfa} onClick={copyTuple}>{copied?<Check size={14}/>:<Download size={14}/>} {copied?'COPIED':'EXPORT JSON'}</button></div>
            {!activeDfa?<div className="details-empty"><span className="details-empty-icon"><ArrowDown size={16}/></span><span>Generate your DFA to inspect its formal definition and transitions.</span></div>:activeTab==='tuple'?<div className="tuple-content"><div className="tuple-equation"><span className="tuple-lhs">M</span><span className="tuple-equals">=</span><span className="tuple-brace">(</span><span className="tuple-values">{activeDfa.states.length} <span className="tuple-comma">,</span> {`{ ${activeDfa.alphabet.join(', ')} }`} <span className="tuple-comma">,</span> δ <span className="tuple-comma">,</span> {activeDfa.start_state} <span className="tuple-comma">,</span> {`{ ${activeDfa.accepting_states.join(', ')||'∅'} }`}</span><span className="tuple-brace">)</span></div><div className="tuple-legend"><span><b>Q</b> states</span><span><b>Σ</b> alphabet</span><span><b>δ</b> transition function</span><span><b>q₀</b> initial state</span><span><b>F</b> accepting states</span></div><div className="tuple-stats"><div><span>Q</span><strong>{`{ ${activeDfa.states.join(', ')} }`}</strong></div><div><span>F</span><strong className="accept-set">{`{ ${activeDfa.accepting_states.join(', ')||'∅'} }`}</strong></div><div><span>δ</span><strong className="complete-badge"><Check size={12}/> COMPLETE</strong></div></div></div>:<div className="table-scroll"><table className="transition-table"><thead><tr><th>STATE</th>{activeDfa.alphabet.map(symbol=><th key={symbol}>ON <code>{symbol}</code></th>)}</tr></thead><tbody>{activeDfa.states.map(state=><tr key={state} className={activeDfa.accepting_states.includes(state)?'accept-row':''}><td><span className="table-state">{state}</span>{state===activeDfa.start_state&&<span className="tiny-start">START</span>}{activeDfa.accepting_states.includes(state)&&<span className="tiny-accept">FINAL</span>}</td>{activeDfa.alphabet.map(symbol=><td key={symbol}><span className="transition-cell">{activeDfa.transitions[state][symbol]}</span></td>)}</tr>)}</tbody></table></div>}
          </div>
        </section>
      </section>
      <section className="simulator panel"><div className="simulator-heading"><div className="panel-title"><div className="title-icon green"><Play size={15}/></div><div><h2>String simulator</h2><span className="panel-kicker">TEST YOUR AUTOMATON</span></div></div><span className="sim-hint"><Sparkles size={13}/> Step through your automaton</span></div><div className="simulator-controls"><label htmlFor="test-string">INPUT STRING</label><div className="sim-input-wrap"><span className="sim-prefix">ω =</span><input id="test-string" className="mono-input" value={testInput} onChange={e=>setTestInput(e.target.value)} placeholder="Enter a string to test" onKeyDown={e=>{if(e.key==='Enter')runSimulation()}}/><button className="run-button" disabled={!activeDfa} onClick={runSimulation}><Play size={14} fill="currentColor"/> Run simulation</button></div><span className="sim-note">Alphabet: <code>{activeDfa?activeDfa.alphabet.join(', '):alphabet.join(', ')||'—'}</code><span>·</span> Empty input is allowed</span></div>
        {simulation&&<div className={`simulation-result ${simulation.accepted?'accepted':'rejected'}`}><div className="result-outcome">{simulation.accepted?<Check size={15}/>:<X size={15}/>}<strong>{simulation.accepted?'ACCEPTED':'REJECTED'}</strong><span>Input ended in <code>{simulation.final_state}</code></span></div><div className="steps-row">{simulation.steps.map((step,i)=><div key={i} className="step-chip"><span className="step-index">{i===0?'START':String(i).padStart(2,'0')}</span>{i>0&&<span className="step-symbol">{step.symbol}</span>}<span className="step-destination">{step.to_state}</span>{i<simulation.steps.length-1&&<ArrowRight size={13} className="step-arrow"/>}</div>)}</div></div>}
      </section>
      <footer className="footer"><div><span className="footer-mark">δ</span><span>Built for the curious mind.</span><span className="footer-dot">·</span><span>Regular languages, made visible.</span></div><span className="footer-right">DETERMINISTIC BY DESIGN <span className="footer-spark">✳</span></span></footer>
    </main>
  </div>
}

function currentRoute() {
  return normalizeRoute(window.location.pathname)
}

function App() {
  const [route, setRoute] = useState(currentRoute)
  const [visited, setVisited] = useState(() => new Set(route === '/' ? [] : [route]))

  useEffect(() => {
    const onPopState = () => {
      const next = currentRoute()
      setRoute(next)
      if (next !== '/') setVisited(previous => new Set([...previous, next]))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function navigate(next) {
    if (window.location.pathname !== next) window.history.pushState({}, '', next)
    setRoute(next)
    if (next !== '/') setVisited(previous => new Set([...previous, next]))
    window.scrollTo(0, 0)
  }

  return <div className="dfa-app">
    <nav className="workspace-switch" aria-label="DFA Studio navigation">
      <button className="nav-brand" onClick={() => navigate('/')} aria-label="DFA Studio home">DFA <b>Studio</b></button>
      <button className={route === '/generator' ? 'selected' : ''} aria-current={route === '/generator' ? 'page' : undefined} onClick={() => navigate('/generator')}>Generator</button>
      <button className={route === '/simulator' ? 'selected' : ''} aria-current={route === '/simulator' ? 'page' : undefined} onClick={() => navigate('/simulator')}>Simulator</button>
    </nav>

    {route === '/' && <main className="home-page">
      <div className="eyebrow"><span className="eyebrow-line"/>THEORY OF COMPUTATION WORKBENCH</div>
      <h1>Explore finite automata.<br/><span>Build understanding.</span></h1>
      <p className="subtitle">Generate machines for regular languages, or build your own and check it formally.</p>
      <div className="home-cards">
        <button className="home-card" onClick={() => navigate('/generator')}>
          <span className="home-card-icon generator-icon"><Sparkles size={20}/></span>
          <strong>DFA Generator</strong>
          <span>Enter a question and generate its DFA.</span>
          <i>Open generator <ArrowRight size={15}/></i>
        </button>
        <button className="home-card" onClick={() => navigate('/simulator')}>
          <span className="home-card-icon simulator-icon"><Activity size={20}/></span>
          <strong>DFA Simulator</strong>
          <span>Build, animate, and verify your own DFA.</span>
          <i>Open simulator <ArrowRight size={15}/></i>
        </button>
      </div>
    </main>}

    {visited.has('/generator') && <div className="app-route" hidden={route !== '/generator'}><ErrorBoundary name="DFA Generator"><GeneratorStudio/></ErrorBoundary></div>}
    {visited.has('/simulator') && <div className="app-route" hidden={route !== '/simulator'}><ErrorBoundary name="DFA Simulator"><StudentDfaWorkbench/></ErrorBoundary></div>}
  </div>
}

export default App
