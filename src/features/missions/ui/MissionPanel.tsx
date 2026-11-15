import { Check, ArrowUpRight, Target } from "lucide-react";
import type { Evaluation } from "../lib/evaluate";
import type { Mission } from "../model/presets";

export function MissionPanel({
  mission,
  missions,
  evaluation,
  onChoose,
  quality,
  dragging,
}: {
  mission: Mission;
  missions: Mission[];
  evaluation: Evaluation;
  onChoose: (id: string) => void;
  quality: "preview" | "stable";
  dragging: boolean;
}) {
  return (
    <section className="mission-panel">
      <div className="section-title">
        实验任务 <Target size={15} />
      </div>
      <div className="mission-tabs">
        {missions.map((entry, i) => (
          <button
            key={entry.id}
            className={entry.id === mission.id ? "active" : ""}
            title={entry.name}
            onClick={() => onChoose(entry.id)}
          >
            {String(i + 1).padStart(2, "0")}
          </button>
        ))}
      </div>
      <span className="tag">{mission.tag}</span>
      <h2>
        {mission.name}
        <ArrowUpRight size={19} />
      </h2>
      <p>{mission.description}</p>
      <div className="mission-condition">
        {evaluation.complete && !evaluation.provisional ? (
          <Check size={15} />
        ) : (
          <span className="circle" />
        )}
        <span>{mission.condition}</span>
      </div>
      {evaluation.bands.length > 0 && (
        <div className="mission-bands">
          {evaluation.bands.map((band) => (
            <div key={band.bandId} className={band.passed ? "passed" : ""}>
              <span>{band.label}</span>
              <b>{(band.share * 100).toFixed(0)}%</b>
              <small>{band.energy.toFixed(2)} W</small>
              {band.energy > 0 && <em>{band.centroid.toFixed(1)} mm</em>}
            </div>
          ))}
        </div>
      )}
      <div className="progress-track">
        <i style={{ width: `${evaluation.progress * 100}%` }} />
      </div>
      <small className={evaluation.complete ? "success" : "muted"}>
        {evaluation.provisional
          ? quality === "preview"
            ? "拖动预览 · 任务判定为近似结果"
            : "拖动中 · 判定基于上一次稳定分析"
          : evaluation.complete
            ? "实验完成 · 已达到目标"
            : evaluation.blockers[0] ?? "探索中 · 调整器件观察变化"}
      </small>
      <code className="analysis-id" title="判定所依据的分析">
        {evaluation.analysisId}
      </code>
      <button className="reset-mission" onClick={() => onChoose(mission.id)}>
        重置本次实验 ↗
      </button>
    </section>
  );
}
