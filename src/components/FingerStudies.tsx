import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { ALL_FINGER_STUDIES, type FingerStudy } from "../core/finger-studies";

export function FingerStudies({ selected, onSelect, onClose }: {
  selected?: string; onSelect: (study: FingerStudy) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="finger-studies" aria-label="指法片段" onCancel={onClose}>
    <div className="study-heading">
      <div><span className="eyebrow">FINGER PHRASES</span><h2>看清每根手指的接力</h2></div>
      <button className="icon-button" aria-label="关闭指法片段" onClick={onClose}><X size={18} /></button>
    </div>
    <div className="study-list">
      {ALL_FINGER_STUDIES.map((study, i) => <button key={study.id}
        className={selected === study.id ? "selected" : ""}
        aria-pressed={selected === study.id} onClick={() => onSelect(study)}>
        <span className="study-number">{String(i + 1).padStart(2, "0")}</span>
        <span><strong>{study.name}</strong><code>{study.algorithm}</code><small>{study.description}</small></span>
        <ArrowUpRight size={15} />
      </button>)}
    </div>
  </dialog>;
}
