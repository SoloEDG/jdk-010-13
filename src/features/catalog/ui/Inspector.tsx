import { Trash2, SlidersHorizontal } from "lucide-react";
import { labels, type Element } from "../../../shared/document";
import { spectrumOf, syncLegacyWavelength } from "../../optics/lib/spectrum";
import { parameters } from "../lib/parameters";
import { SpectrumEditor } from "./SpectrumEditor";

export function Inspector({
  element,
  onUpdate,
  onRemove,
}: {
  element?: Element;
  onUpdate: (patch: Partial<Element>) => void;
  onRemove: () => void;
}) {
  if (!element)
    return (
      <section className="inspector">
        <div className="section-title">
          器件属性 <SlidersHorizontal size={15} />
        </div>
        <p className="empty">
          选择实验台上的器件
          <br />
          查看并调整光学参数
        </p>
      </section>
    );
  return (
    <section className="inspector">
      <div className="section-title">
        器件属性 <SlidersHorizontal size={15} />
      </div>
      <div className="selected-name">
        <i />
        {labels[element.kind]}
        <span>已选中</span>
      </div>
      <div className="coordinates">
        {(["x", "y"] as const).map((key) => (
          <label key={key}>
            {key.toUpperCase()}
            <input
              aria-label={key + " 坐标"}
              type="number"
              min="20"
              max={key === "x" ? 980 : 580}
              value={Math.round(element[key])}
              onChange={(e) =>
                onUpdate({
                  [key]: Math.max(
                    20,
                    Math.min(key === "x" ? 980 : 580, Number(e.target.value)),
                  ),
                })
              }
            />
            <small>mm</small>
          </label>
        ))}
      </div>
      {parameters(element).map((parameter) => (
        <label className="parameter" key={parameter.key}>
          <span>
            {parameter.label}
            <b>
              {Number(element[parameter.key]).toFixed(
                parameter.step < 1 ? 2 : 0,
              )}{" "}
              <small>{parameter.unit}</small>
            </b>
          </span>
          <input
            aria-label={parameter.label}
            type="range"
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            value={Number(element[parameter.key])}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (parameter.key === "wavelength" && element.kind === "source") {
                // The main wavelength slider edits the first line in place,
                // keeping weights and every other band untouched.
                const spectrum = spectrumOf(element);
                const first = spectrum.bands[0];
                if (first.kind !== "line") {
                  onUpdate({ wavelength: value });
                  return;
                }
                const bands = [
                  { ...first, wavelength: value },
                  ...spectrum.bands.slice(1),
                ];
                onUpdate({
                  wavelength: value,
                  spectrum: { mode: spectrum.mode, bands },
                });
                return;
              }
              const patch = {
                [parameter.key]:
                  parameter.key === "focal" && value === 0 ? 10 : value,
              } as Partial<Element>;
              // Power/ray/spread edits leave the spectrum untouched; only a
              // single-line spectrum needs its legacy wavelength mirrored.
              onUpdate(
                element.kind === "source" && parameter.key !== "wavelength"
                  ? syncLegacyWavelength({ ...element, ...patch })
                  : patch,
              );
            }}
          />
          <div className="range-label">
            <span>{parameter.min}</span>
            <span>{parameter.max}</span>
          </div>
        </label>
      ))}
      {element.kind === "source" && (
        <SpectrumEditor element={element} onUpdate={onUpdate} />
      )}
      <button className="delete" onClick={onRemove}>
        <Trash2 size={14} />
        移除器件
      </button>
    </section>
  );
}
