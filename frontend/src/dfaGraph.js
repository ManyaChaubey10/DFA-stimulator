export function transitionEdgesFromDfa(dfa, { allowPartial = false } = {}) {
  return dfa.states.flatMap((source) =>
    dfa.alphabet.map((symbol) => {
      const target = dfa.transitions[source]?.[symbol]
      if (typeof target !== 'string' || !target) {
        if (allowPartial) return null
        throw new Error(`Missing transition ?(${source}, ${symbol})`)
      }
      return { id: JSON.stringify([source, symbol, target]), source, target, data: { symbol, label: symbol } }
    }).filter(Boolean),
  )
}

export function assertTransitionEdgesMatchDfa(dfa, edges) {
  const expected = new Set(
    dfa.states.flatMap((source) =>
      dfa.alphabet.map((symbol) => JSON.stringify([source, symbol, dfa.transitions[source]?.[symbol]])),
    ),
  )
  const actual = edges.map((edge) => JSON.stringify([edge.source, edge.data?.symbol, edge.target]))
  const actualSet = new Set(actual)
  if (actual.length !== expected.size || actualSet.size !== actual.length) {
    throw new Error(`Diagram edge count mismatch: expected ${expected.size}, received ${actual.length}`)
  }
  for (const key of expected) {
    if (!actualSet.has(key)) throw new Error(`Diagram is missing transition ${key}`)
  }
  for (const key of actualSet) {
    if (!expected.has(key)) throw new Error(`Diagram contains an extra transition ${key}`)
  }
  for (const edge of edges) {
    if (edge.data?.label !== edge.data?.symbol) {
      throw new Error(`Diagram label does not match transition symbol for ${edge.id}`)
    }
  }
  return true
}
