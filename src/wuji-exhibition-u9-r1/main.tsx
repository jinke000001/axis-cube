import { createRoot } from "react-dom/client";
import { Component, type PropsWithChildren } from "react";
import DemonstratorApp from "./ExhibitionApp";
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
          请重新加载页面后继续。原有记录保留。
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
