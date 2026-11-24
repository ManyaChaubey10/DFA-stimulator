const reservedSymbols = new Set(['(', ')', '|', '*', '+', '?', '\u03b5', '\u2205'])

export function parseAlphabet(input) {
  return String(input || '').replace(/[{}]/g, '').split(',').map(symbol => symbol.trim()).filter(Boolean)
}

export function createStudentModel() {
  return {
    mode: 'natural', alphabetInput: '0, 1',
    description: 'Strings ending with 01', expression: '(0|1)*01',
    states: ['q0'], alphabet: ['0', '1'], transitions: { q0: {} },
    start_state: 'q0', accepting_states: [], positions: {},
  }
}

export function serializeStudentModel(model) {
  return { format: 'dfa-studio-student-dfa', version: 1, model }
}

export function deserializeStudentModel(value, current = createStudentModel()) {
  const model = value?.format === 'dfa-studio-student-dfa' ? value.model : value
  if (!model || typeof model !== 'object' || !Array.isArray(model.states) || !Array.isArray(model.alphabet) || !model.transitions || typeof model.transitions !== 'object') {
    throw new Error('This file does not contain a DFA Studio state list, alphabet, and transition map.')
  }
  if (model.states.some(state => typeof state !== 'string') || model.alphabet.some(symbol => typeof symbol !== 'string')) {
    throw new Error('State names and alphabet symbols must be strings.')
  }
  if (new Set(model.states).size !== model.states.length || new Set(model.alphabet).size !== model.alphabet.length) {
    throw new Error('The file contains duplicate states or alphabet symbols.')
  }
  if (!Array.isArray(model.accepting_states) || typeof model.start_state !== 'string') {
    throw new Error('The file must specify an initial state and an accepting-state list.')
  }
  const transitions = Object.fromEntries(model.states.map(state => {
    const row = model.transitions[state] || {}
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.values(row).some(target => typeof target !== 'string')) {
      throw new Error(`Transition row for ${state} must map each symbol to one destination.`)
    }
    return [state, { ...row }]
  }))
  const alphabet = [...model.alphabet]
  return {
    ...current, ...model,
    mode: model.mode === 'regex' ? 'regex' : 'natural',
    alphabet, alphabetInput: alphabet.join(', '),
    states: [...model.states], transitions,
    accepting_states: [...model.accepting_states], positions: { ...(model.positions || {}) },
  }
}

export function setModelAlphabet(model, alphabetInput) {
  const alphabet = parseAlphabet(alphabetInput)
  const transitions = Object.fromEntries(model.states.map(state => [
    state,
    Object.fromEntries(Object.entries(model.transitions[state] || {}).filter(([symbol]) => alphabet.includes(symbol))),
  ]))
  return { ...model, alphabetInput, alphabet, transitions }
}

export function addStudentState(model) {
  let index = 0
  while (model.states.includes(`q${index}`)) index += 1
  const state = `q${index}`
  return { ...model, states: [...model.states, state], transitions: { ...model.transitions, [state]: {} } }
}

export function renameStudentState(model, oldName, newName) {
  const name = newName.trim()
  if (!name) throw new Error('State names cannot be empty.')
  if (name !== oldName && model.states.includes(name)) throw new Error(`State name "${name}" already exists.`)
  if (name === oldName) return model
  const states = model.states.map(state => state === oldName ? name : state)
  const transitions = {}
  for (const state of model.states) {
    const renamed = state === oldName ? name : state
    transitions[renamed] = Object.fromEntries(Object.entries(model.transitions[state] || {}).map(([symbol, target]) => [symbol, target === oldName ? name : target]))
  }
  const positions = { ...model.positions }
  if (positions[oldName]) { positions[name] = positions[oldName]; delete positions[oldName] }
  return {
    ...model, states, transitions, positions,
    start_state: model.start_state === oldName ? name : model.start_state,
    accepting_states: model.accepting_states.map(state => state === oldName ? name : state),
  }
}

export function removeStudentState(model, state) {
  const states = model.states.filter(item => item !== state)
  const transitions = Object.fromEntries(states.map(source => [
    source,
    Object.fromEntries(Object.entries(model.transitions[source] || {}).filter(([, target]) => target !== state)),
  ]))
  const positions = { ...model.positions }
  delete positions[state]
  return {
    ...model, states, transitions, positions,
    start_state: model.start_state === state ? (states[0] || '') : model.start_state,
    accepting_states: model.accepting_states.filter(item => item !== state),
  }
}

export function setStudentTransition(model, source, symbol, destination) {
  const transitions = { ...model.transitions, [source]: { ...(model.transitions[source] || {}) } }
  if (!destination) delete transitions[source][symbol]
  else transitions[source][symbol] = destination
  return { ...model, transitions }
}

export function asDfa(model) {
  return {
    states: [...model.states], alphabet: [...model.alphabet],
    transitions: Object.fromEntries(model.states.map(state => [state, { ...(model.transitions[state] || {}) }])),
    start_state: model.start_state, accepting_states: [...model.accepting_states],
    expression: model.mode === 'regex' ? model.expression : '',
    description: model.mode === 'natural' ? model.description : '', complete: false,
  }
}

export function validateStudentDfa(dfa) {
  const errors = []
  if (!dfa.states.length) errors.push('Add at least one state.')
  if (dfa.states.some(state => !state.trim())) errors.push('State names cannot be empty.')
  if (new Set(dfa.states).size !== dfa.states.length) errors.push('State names must be unique.')
  if (!dfa.alphabet.length) errors.push('Enter at least one alphabet symbol.')
  if (dfa.alphabet.some(symbol => symbol.length !== 1 || reservedSymbols.has(symbol))) errors.push('Use unique single-character alphabet symbols; regex operators and epsilon are reserved.')
  if (new Set(dfa.alphabet).size !== dfa.alphabet.length) errors.push('Alphabet symbols must be unique.')
  if (!dfa.start_state || !dfa.states.includes(dfa.start_state)) errors.push('Choose exactly one initial state.')
  if (dfa.accepting_states.some(state => !dfa.states.includes(state))) errors.push('Accepting states must be in Q.')
  for (const state of dfa.states) {
    const row = dfa.transitions[state] || {}
    for (const symbol of dfa.alphabet) {
      const target = row[symbol]
      if (target === undefined || target === '') errors.push(`Missing transition δ(${state}, ${symbol}).`)
      else if (!dfa.states.includes(target)) errors.push(`Transition δ(${state}, ${symbol}) leads to unknown state "${target}".`)
    }
    for (const symbol of Object.keys(row)) if (!dfa.alphabet.includes(symbol)) errors.push(`Unexpected transition symbol "${symbol}" from ${state}.`)
  }
  return [...new Set(errors)]
}

export function makeTrace(dfa, input) {
  const invalid = validateStudentDfa(dfa)
  if (invalid.length) throw new Error(invalid[0])
  let state = dfa.start_state
  const steps = [{ index: 0, symbol: '', from_state: null, to_state: state, note: 'Start' }]
  for (const [index, symbol] of [...input].entries()) {
    if (!dfa.alphabet.includes(symbol)) throw new Error(`Input symbol "${symbol}" at position ${index + 1} is not in the alphabet.`)
    const next = dfa.transitions[state][symbol]
    steps.push({ index: index + 1, symbol, from_state: state, to_state: next, note: `δ(${state}, ${symbol}) = ${next}` })
    state = next
  }
  return { input, accepted: dfa.accepting_states.includes(state), final_state: state, steps }
}
