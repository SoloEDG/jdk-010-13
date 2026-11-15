import { Plus, Trash2 } from "lucide-react";
import type {
  Element,
  SpectrumBand,
  SpectrumMode,
} from "../../../shared/document";
import {
  MAX_BANDS,
  VISIBLE_MAX,
  VISIBLE_MIN,
  bandLabel,
  bandRange,
  continuousBand,
  convertSpectrum,
  lineBand,
  makeSpectrum,
  spectrumOf,
} from "../../optics/lib/spectrum";

const MODES: { mode: SpectrumMode; label: string }[] = [
  { mode: "mono", label: "单色" },
  { mode: "lines", label: "谱线" },
  { mode: "continuous", label: "连续" },
];

/**
 * Spectrum editor. Total power never depends on how many bands or samples
 * exist: weights are relative, and the source's `power` is redistributed.
 * Switching modes keeps each band's weight, so the emitted total is unchanged.
 */
export function SpectrumEditor({
  element,
  onUpdate,
}: {
  element: Element;
  onUpdate: (patch: Partial<Element>) => void;
}) {
  const spectrum = spectrumOf(element);
  const bands = spectrum.bands;
  const total = bands.reduce((sum, band) => sum + Math.max(0, band.weight), 0);
  const commit = (mode: SpectrumMode, next: SpectrumBand[]) =>
    onUpdate({ spectrum: makeSpectrum(mode, next) });
  const patchBand = (id: string, patch: Partial<SpectrumBand>) =>
    commit(
      spectrum.mode,
      bands.map((band) => (band.id === id ? ({ ...band, ...patch } as SpectrumBand) : band)),
    );

  return (
    <div className="spectrum-editor">
      <div className="spectrum-head">
        <span>光谱</span>
        <div className="spectrum-modes">
          {MODES.map((entry) => (
            <button
              key={entry.mode}
              className={spectrum.mode === entry.mode ? "active" : ""}
              onClick={() =>
                onUpdate({ spectrum: convertSpectrum(spectrum, entry.mode) })
              }
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <div className="spectrum-total">
        总功率 <b>{element.power.toFixed(2)} W</b>
        <small>按权重分配 · 与采样数无关</small>
      </div>
      {bands.map((band, index) => {
        const [from, to] = bandRange(band);
        const share = total > 0 ? Math.max(0, band.weight) / total : 0;
        return (
          <div className="spectrum-band" key={band.id}>
            <div className="spectrum-band-head">
              <span className={`swatch ${band.kind}`} />
              <strong>
                {band.kind === "line" ? "谱线" : "波段"} {index + 1}
              </strong>
              <small>{bandLabel(band)}</small>
              {bands.length > 1 && (
                <button
                  className="band-remove"
                  title="删除波段"
                  onClick={() =>
                    commit(
                      spectrum.mode,
                      bands.filter((candidate) => candidate.id !== band.id),
                    )
                  }
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            <div className="spectrum-band-fields">
              <label>
                {band.kind === "line" ? "波长" : "起点"}
                <input
                  type="number"
                  aria-label={`${bandLabel(band)} 起点`}
                  min={VISIBLE_MIN}
                  max={VISIBLE_MAX}
                  value={Math.round(from)}
                  onChange={(e) =>
                    band.kind === "line"
                      ? patchBand(band.id, {
                          wavelength: Number(e.target.value),
                        } as Partial<SpectrumBand>)
                      : patchBand(band.id, {
                          from: Number(e.target.value),
                          to: Math.max(Number(e.target.value) + 1, to),
                        } as Partial<SpectrumBand>)
                  }
                />
              </label>
              {band.kind === "continuous" && (
                <label>
                  终点
                  <input
                    type="number"
                    aria-label={`${bandLabel(band)} 终点`}
                    min={VISIBLE_MIN}
                    max={VISIBLE_MAX}
                    value={Math.round(to)}
                    onChange={(e) =>
                      patchBand(band.id, {
                        to: Math.max(from + 1, Number(e.target.value)),
                      } as Partial<SpectrumBand>)
                    }
                  />
                </label>
              )}
              <label className="weight">
                权重
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  aria-label={`${bandLabel(band)} 权重`}
                  value={Number(band.weight.toFixed(2))}
                  onChange={(e) =>
                    patchBand(band.id, {
                      weight: Math.max(0.1, Number(e.target.value)),
                    } as Partial<SpectrumBand>)
                  }
                />
                <em>{(share * 100).toFixed(0)}% · {(element.power * share).toFixed(2)} W</em>
              </label>
            </div>
          </div>
        );
      })}
      {spectrum.mode !== "mono" && bands.length < MAX_BANDS && (
        <button
          className="band-add"
          onClick={() =>
            commit(spectrum.mode, [
              ...bands,
              spectrum.mode === "continuous"
                ? continuousBand(
                    Math.min(
                      VISIBLE_MAX - 20,
                      Math.max(...bands.map((band) => bandRange(band)[1])) + 10,
                    ),
                    Math.min(
                      VISIBLE_MAX,
                      Math.max(...bands.map((band) => bandRange(band)[1])) + 30,
                    ),
                    1,
                  )
                : lineBand(
                    Math.min(
                      VISIBLE_MAX,
                      Math.max(...bands.map((band) => bandRange(band)[0])) + 20,
                    ),
                    1,
                  ),
            ])
          }
        >
          <Plus size={12} />
          添加{spectrum.mode === "continuous" ? "波段" : "谱线"}
        </button>
      )}
      {spectrum.mode === "continuous" && (
        <p className="spectrum-hint">
          连续谱在稳定分析中最多细化 6 轮；采样误差显示在接收屏面板。
        </p>
      )}
    </div>
  );
}
