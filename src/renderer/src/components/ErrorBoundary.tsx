import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Logo } from './Icon'
import { tx } from '@/lib/i18n'

interface State {
  error: Error | null
}

/** A render bug shows a readable screen with a way out instead of a black window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // picked up by the main process and written to logs/api.log
    console.error(`UI crash: ${error.message}\n${info.componentStack ?? ''}`)
  }

  private resetSession = (): void => {
    void window.sc.prefs.set({ session: null, sessionPosition: 0 }).then(() => location.reload())
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="login">
        <div className="drag-strip" />
        <div className="login-col">
          <Logo size={48} />
          <h1 className="login-title small">{tx("Что-то сломалось")}</h1>
          <p className="login-lead">{tx("Интерфейс упал с ошибкой. Её текст записан в журнал приложения.")}</p>
          <code className="crash-text">{error.message}</code>
          <div className="row-gap">
            <button className="btn btn-primary" onClick={() => location.reload()}>{tx("Перезагрузить")}</button>
            <button className="btn btn-outline" onClick={this.resetSession}>{tx("Сбросить очередь и перезагрузить")}</button>
          </div>
        </div>
      </div>
    )
  }
}
