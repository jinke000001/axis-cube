import { createRoot } from "react-dom/client";
import { Component, type PropsWithChildren } from "react";
import DemonstratorApp from "./demonstrator/DemonstratorApp";
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
        <h1>页面需要重新加载</h1>
        <p>
          已保存的学习进度、魔方局面与录入草稿仍留在这台设备。请重新加载后继续。
        </p>
        <button className="primary-button" onClick={() => location.reload()}>
          重新加载页面
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <RecoveryBoundary>
    <DemonstratorApp />
  </RecoveryBoundary>,
);
