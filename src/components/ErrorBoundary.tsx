import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error)
      return (
        <main className="error-panel" role="alert">
          <h1>档案加载遇到问题</h1>
          <p>{this.state.error}</p>
          <p>现有数据保留在本机，请重新加载后尝试导出备份。</p>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </main>
      );
    return this.props.children;
  }
}
