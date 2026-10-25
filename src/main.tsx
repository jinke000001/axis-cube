import { createRoot } from "react-dom/client";
import { Component, type PropsWithChildren } from "react";
import App from "./App";
import "./style.css";
class RecoveryBoundary extends Component<
  PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="recovery-screen">
        <div className="eyebrow">AXIS / RECOVERY</div>
        <h1>工作台需要重新加载</h1>
        <p>
          已保存的局面与录入草稿仍留在此浏览器。请重新加载；若仍无法显示三维场景，请在支持
          WebGL 的浏览器中打开。
        </p>
        <button className="primary-button" onClick={() => location.reload()}>
          重新加载工作台
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <RecoveryBoundary>
    <App />
  </RecoveryBoundary>,
);
