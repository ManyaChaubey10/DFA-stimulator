import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRoute, DFA_ROUTES } from '../src/routes.js'

test('generator and simulator have stable direct routes with home fallback', () => {
  assert.equal(normalizeRoute('/'), DFA_ROUTES.home)
  assert.equal(normalizeRoute('/generator'), DFA_ROUTES.generator)
  assert.equal(normalizeRoute('/simulator/'), DFA_ROUTES.simulator)
  assert.equal(normalizeRoute('/unknown'), DFA_ROUTES.home)
})
