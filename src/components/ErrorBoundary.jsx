import { Component } from 'react'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error in app tree:', error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen bg-[#071117] text-earth-100 grid place-items-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-red-500/20">
            <AlertTriangle className="h-6 w-6 text-red-400" />
          </div>
          <h1 className="text-lg font-semibold text-white">Something went wrong</h1>
          <p className="mt-1.5 text-sm text-earth-300">
            This page hit an unexpected error. Your data is safe — try reloading.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              <RotateCcw className="h-4 w-4" /> Reload
            </button>
            <button
              onClick={() => { window.location.href = '/' }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-earth-700 px-4 py-2 text-sm font-medium text-earth-200 hover:bg-earth-800/50 transition-colors"
            >
              <Home className="h-4 w-4" /> Go home
            </button>
          </div>
        </div>
      </div>
    )
  }
}
