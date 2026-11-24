import assert from 'node:assert/strict'
import test from 'node:test'
import { assertTransitionEdgesMatchDfa, transitionEdgesFromDfa } from '../src/dfaGraph.js'

const expectedDfa = {
  states: ['q0', 'q1', 'q2', 'q3'],
  alphabet: ['0', '1'],
  transitions: {
    q0: { '0': 'q1', '1': 'q2' },
    q1: { '0': 'q1', '1': 'q3' },
    q2: { '0': 'q1', '1': 'q2' },
    q3: { '0': 'q1', '1': 'q2' },
  },
  start_state: 'q0',
  accepting_states: ['q3'],
}

test('diagram has one correctly labeled edge per transition-table cell', () => {
  const edges = transitionEdgesFromDfa(expectedDfa)
  assert.equal(edges.length, expectedDfa.states.length * expectedDfa.alphabet.length)
  assert.equal(edges.length, 8)
  assert.equal(assertTransitionEdgesMatchDfa(expectedDfa, edges), true)
  assert.deepEqual(edges.map(({ source, data, target }) => [source, data.label, target]), [
    ['q0', '0', 'q1'], ['q0', '1', 'q2'],
    ['q1', '0', 'q1'], ['q1', '1', 'q3'],
    ['q2', '0', 'q1'], ['q2', '1', 'q2'],
    ['q3', '0', 'q1'], ['q3', '1', 'q2'],
  ])
})

test('same-endpoint, reciprocal, and self-loop transitions remain distinct', () => {
  const dfa = {
    states: ['A', 'B'],
    alphabet: ['0', '1', '2'],
    transitions: { A: { '0': 'B', '1': 'B', '2': 'A' }, B: { '0': 'A', '1': 'B', '2': 'B' } },
  }
  const edges = transitionEdgesFromDfa(dfa)
  assert.equal(edges.length, 6)
  assert.equal(new Set(edges.map(edge => edge.id)).size, 6)
  assertTransitionEdgesMatchDfa(dfa, edges)
  assert.equal(edges.filter(edge => edge.source === 'A' && edge.target === 'B').length, 2)
  assert.equal(edges.filter(edge => edge.source === edge.target).length, 3)
})

test('consistency check rejects incorrect directions, labels, and omitted edges', () => {
  const edges = transitionEdgesFromDfa(expectedDfa)
  assert.throws(() => assertTransitionEdgesMatchDfa(expectedDfa, edges.slice(1)), /edge count mismatch/i)
  const wrongDirection = edges.map(edge => ({ ...edge }))
  wrongDirection[0] = { ...wrongDirection[0], source: 'q1', target: 'q0' }
  assert.throws(() => assertTransitionEdgesMatchDfa(expectedDfa, wrongDirection), /transition|extra/i)
  const wrongLabel = edges.map(edge => ({ ...edge, data: { ...edge.data } }))
  wrongLabel[0].data.label = '1'
  assert.throws(() => assertTransitionEdgesMatchDfa(expectedDfa, wrongLabel), /label/i)
})


test('minimized view also produces one exact edge per minimized transition', () => {
  const minimized = {
    states: ['q0', 'q1', 'q2'],
    alphabet: ['0', '1'],
    transitions: { q0: { '0': 'q1', '1': 'q0' }, q1: { '0': 'q1', '1': 'q2' }, q2: { '0': 'q1', '1': 'q0' } },
    start_state: 'q0',
    accepting_states: ['q2'],
  }
  const edges = transitionEdgesFromDfa(minimized)
  assert.equal(edges.length, 6)
  assertTransitionEdgesMatchDfa(minimized, edges)
})
