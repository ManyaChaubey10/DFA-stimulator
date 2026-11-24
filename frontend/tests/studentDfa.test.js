import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addStudentState, asDfa, createStudentModel, deserializeStudentModel, makeTrace, parseAlphabet, serializeStudentModel,
  removeStudentState, renameStudentState, setModelAlphabet, setStudentTransition,
  validateStudentDfa,
} from '../src/studentDfa.js'
import { assertTransitionEdgesMatchDfa, transitionEdgesFromDfa } from '../src/dfaGraph.js'

function completeTwoStateMachine() {
  let model = createStudentModel()
  model = addStudentState(model)
  model = { ...model, accepting_states: ['q1'] }
  model = setStudentTransition(model, 'q0', '0', 'q1')
  model = setStudentTransition(model, 'q0', '1', 'q0')
  model = setStudentTransition(model, 'q1', '0', 'q1')
  model = setStudentTransition(model, 'q1', '1', 'q0')
  return model
}

test('diagram and editable table use the same canonical transitions', () => {
  const dfa = asDfa(completeTwoStateMachine())
  const edges = transitionEdgesFromDfa(dfa)
  assert.equal(edges.length, dfa.states.length * dfa.alphabet.length)
  assert.equal(assertTransitionEdgesMatchDfa(dfa, edges), true)
  assert.deepEqual(edges.map(edge => [edge.source, edge.data.symbol, edge.target]), [
    ['q0', '0', 'q1'], ['q0', '1', 'q0'], ['q1', '0', 'q1'], ['q1', '1', 'q0'],
  ])
})

test('diagram can show partial student transitions without inventing edges', () => {
  const dfa = asDfa(createStudentModel())
  assert.deepEqual(transitionEdgesFromDfa(dfa, { allowPartial: true }), [])
  assert.match(validateStudentDfa(dfa)[0], /Missing transition/)
})

test('renaming and removing states update all references and discard incoming transitions', () => {
  let model = completeTwoStateMachine()
  model = { ...model, start_state: 'q1', positions: { q1: { x: 20, y: 40 } } }
  model = renameStudentState(model, 'q1', 'accept')
  assert.equal(model.start_state, 'accept')
  assert.deepEqual(model.accepting_states, ['accept'])
  assert.deepEqual(model.positions.accept, { x: 20, y: 40 })
  assert.equal(model.transitions.q0['0'], 'accept')
  model = removeStudentState(model, 'accept')
  assert.equal(model.start_state, 'q0')
  assert.deepEqual(model.accepting_states, [])
  assert.equal(model.transitions.q0['0'], undefined)
})

test('simulator handles empty strings, loops, step traces, acceptance and invalid symbols', () => {
  const dfa = asDfa(completeTwoStateMachine())
  const empty = makeTrace(dfa, '')
  assert.equal(empty.accepted, false)
  assert.equal(empty.steps.length, 1)
  const accepted = makeTrace(dfa, '000')
  assert.equal(accepted.accepted, true)
  assert.deepEqual(accepted.steps.map(step => step.to_state), ['q0', 'q1', 'q1', 'q1'])
  assert.throws(() => makeTrace(dfa, '0x'), /not in the alphabet/)
})

test('alphabet parsing synchronizes transition rows and rejects unsupported tokenization', () => {
  assert.deepEqual(parseAlphabet('{a, b, c}'), ['a', 'b', 'c'])
  let model = completeTwoStateMachine()
  model = setModelAlphabet(model, 'a, b')
  assert.deepEqual(model.alphabet, ['a', 'b'])
  assert.deepEqual(model.transitions, { q0: {}, q1: {} })
  assert.match(validateStudentDfa(asDfa(model))[0], /Missing transition/)
  model = setModelAlphabet(model, 'token, b')
  assert.match(validateStudentDfa(asDfa(model)).find(error => error.includes('single-character')) || '', /single-character/)
})

test('student DFA save/load round-trips editor state and validates malformed files', () => {
  const model = { ...completeTwoStateMachine(), mode: 'regex', expression: '(0|1)*0', positions: { q0: { x: 10, y: 25 } } }
  const saved = serializeStudentModel(model)
  const loaded = deserializeStudentModel(JSON.parse(JSON.stringify(saved)))
  assert.deepEqual(loaded.states, model.states)
  assert.deepEqual(loaded.transitions, model.transitions)
  assert.deepEqual(loaded.positions, model.positions)
  assert.equal(loaded.mode, 'regex')
  assert.throws(() => deserializeStudentModel({ states: [], alphabet: null }), /does not contain/)
})
