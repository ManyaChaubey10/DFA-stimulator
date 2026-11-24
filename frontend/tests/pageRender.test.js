import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

async function renderRoute(pathname) {
  globalThis.window = {
    location: { pathname, origin: 'http://localhost' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {},
    history: { pushState() {} },
  }
  const vite = await createServer({
    root: process.cwd(), configFile: false, plugins: [react()],
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
  })
  const originalError = console.error
  console.error = (...args) => {
    if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) originalError(...args)
  }
  try {
    const { default: App } = await vite.ssrLoadModule('/src/App.jsx')
    return renderToString(React.createElement(App))
  } finally {
    console.error = originalError
    await vite.close()
  }
}

test('Simulator route renders its editable DFA workbench and React Flow diagram', async () => {
  const html = await renderRoute('/simulator')
  assert.match(html, /DFA Studio navigation/)
  assert.match(html, /Add state/)
  assert.match(html, /Construct your DFA/)
  assert.match(html, /Run simulation|Run</)
  assert.match(html, /diagram-flow/)
  assert.doesNotMatch(html, /Something went wrong/)
})

test('Generator route renders generation, diagram, tuple, and table views', async () => {
  const html = await renderRoute('/generator')
  assert.match(html, /Generate DFA/)
  assert.match(html, /State transition diagram/)
  assert.match(html, /5-tuple/)
  assert.match(html, /Transition table/)
  assert.doesNotMatch(html, /Something went wrong/)
})

test('a generated DFA can mount the shared graph renderer with its transitions', async () => {
  globalThis.window = {
    location: { pathname: '/generator', origin: 'http://localhost' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {},
    history: { pushState() {} },
  }
  const vite = await createServer({
    root: process.cwd(), configFile: false, plugins: [react()],
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
  })
  const originalError = console.error
  console.error = (...args) => {
    if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) originalError(...args)
  }
  try {
    const { default: StateDiagram } = await vite.ssrLoadModule('/src/StateDiagram.jsx')
    const dfa = {
      states: ['q0', 'q1'], alphabet: ['0'],
      transitions: { q0: { 0: 'q1' }, q1: { 0: 'q1' } },
      start_state: 'q0', accepting_states: ['q1'], expression: '0+',
    }
    const html = renderToString(React.createElement(StateDiagram, { dfa }))
    assert.match(html, /data-id="q0"/)
    assert.match(html, /data-id="q1"/)
    assert.match(html, /0/)
  } finally {
    console.error = originalError
    await vite.close()
  }
})
