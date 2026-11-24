export const DFA_ROUTES = Object.freeze({ home: '/', generator: '/generator', simulator: '/simulator' })

export function normalizeRoute(pathname) {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/'
  return Object.values(DFA_ROUTES).includes(path) ? path : DFA_ROUTES.home
}
