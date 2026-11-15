import type { AnalysisQuality, Element } from "../../../shared/document";
import type { Measurement } from "../lib/measurement";
import { BandLegend, EnergyChart } from "./EnergyChart";

interface BandOption {
  id: string;
  source: string;
  label: string;
  energy: number;
}

export function DetectorPanel({
  screen,
  screens,
  measurement: m,
  onChoose,
  resolution,
  onResolution,
  bands,
  bandFilter,
  onBandFilter,
  quality,
  analysisId,
  budgetLimited,
  mergedLines,
}: {
  screen?: Element;
  screens: Element[];
  measurement: Measurement;
  onChoose: (id: string) => void;
  resolution: number;
  onResolution: (n: number) => void;
  bands: BandOption[];
  bandFilter: string;
  onBandFilter: (id: string) => void;
  quality: AnalysisQuality;
  analysisId: string;
  budgetLimited: boolean;
  mergedLines: number;
}) {
  return (
    <section className="detector">
      <div className="section-title">
        接收屏分析
        <span className={"live-dot " + quality}>
          {quality === "preview" ? "拖动预览 · 近似" : "稳定测量"}
        </span>
      </div>
      <div className="detector-body">
        <div className="chart-wrap">
          <div className="chart-heading">
            <select
              aria-label="接收屏"
              value={screen?.id ?? ""}
              onChange={(e) => onChoose(e.target.value)}
            >
              {screens.length ? (
                screens.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    接收屏 {i + 1}
                  </option>
                ))
              ) : (
                <option value="">尚无接收屏</option>
              )}
            </select>
            <select
              aria-label="波段"
              value={bandFilter}
              onChange={(e) => onBandFilter(e.target.value)}
            >
              <option value="">全部波段</option>
              {bands.map((band, i) => (
                <option key={band.id} value={band.id}>
                  {bands.length > 1 ? `波段 ${i + 1} · ` : ""}
                  {band.label}
                </option>
              ))}
            </select>
            <select
              aria-label="采样精度"
              value={resolution}
              onChange={(e) => onResolution(Number(e.target.value))}
            >
              <option value="32">32 区间</option>
              <option value="64">64 区间</option>
              <option value="128">128 区间</option>
            </select>
          </div>
          <EnergyChart measurement={m} />
          <BandLegend measurement={m} />
          <div className="chart-axis">
            <span>−{(screen?.size ?? 0) / 2} mm</span>
            <span>光轴中心</span>
            <span>+{(screen?.size ?? 0) / 2} mm</span>
          </div>
        </div>
        <div className="measurements">
          <div>
            <small>接收能量</small>
            <strong>
              {m.energy.toFixed(3)} <em>W</em>
            </strong>
          </div>
          <div>
            <small>光斑 RMS 半径</small>
            <strong>
              {m.spread.toFixed(2)} <em>mm</em>
            </strong>
          </div>
          <div>
            <small>命中光线</small>
            <strong>
              {m.count} <em>条</em>
            </strong>
          </div>
          <div className="accuracy">
            <small>采样误差</small>
            {/* Both numbers describe the bands currently selected, so a band
                filter narrows the error estimate along with the curve. */}
            <span>
              ±{m.uncertainty.toFixed(3)} W
              {m.maxGap > 0 ? ` · 最大间隔 ${m.maxGap.toFixed(1)} nm` : ""}
            </span>
            {budgetLimited && <b>受光线预算限制</b>}
            {mergedLines > 0 && (
              <b>已合并 {mergedLines} 条过密谱线（功率守恒）</b>
            )}
            <code title="分析 ID：光谱 + 布局 + 采样">{analysisId}</code>
          </div>
        </div>
      </div>
    </section>
  );
}
