import { Component } from 'react'

/** Keep a rendering failure visible and recoverable instead of leaving a blank route. */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(`DFA Studio ${this.props.name || 'page'} render error`, error, info.componentStack)
  }

  retry = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return <section className="render-error" role="alert">
      <div className="render-error-mark">!</div>
      <p className="render-error-kicker">{this.props.name || 'DFA Studio'} could not render</p>
      <h2>Something went wrong</h2>
      <p className="render-error-message">{error.message || String(error)}</p>
      {error.stack && <details><summary>Technical details</summary><pre>{error.stack}</pre></details>}
      <div className="render-error-actions">
        <button onClick={this.retry}>Try again</button>
        <button className="secondary" onClick={() => window.location.reload()}>Reload app</button>
      </div>
    </section>
  }
}
