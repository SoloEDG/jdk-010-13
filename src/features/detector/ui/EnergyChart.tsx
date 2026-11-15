import type { BandMeasurement, Measurement } from "../lib/measurement";

const PALETTE = [
  "#9e7bff",
  "#63b7ff",
  "#5ff1d0",
  "#c3f275",
  "#ffc767",
  "#ff7574",
  "#e8a0ff",
  "#7fe0a8",
];

/**
 * Stacked per-band bars. A single-band result draws exactly the old chart, so
 * legacy experiments look unchanged, while a spectrum shows which band
 * contributes which part of the spot.
 */
export function EnergyChart({
  measurement: m,
  split = true,
}: {
  measurement: Measurement;
  split?: boolean;
}) {
  const bands: BandMeasurement[] = split ? m.bands : [];
  const width = 600;
  const height = 100;
  const scale = m.peak ? 85 / m.peak : 0;
  return (
    <svg
      className="energy-chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-label="接收屏光能分布"
    >
      {[25, 50, 75].map((y) => (
        <line
          key={y}
          x1="0"
          x2={width}
          y1={y}
          y2={y}
          stroke="#26323c"
          strokeDasharray="3 5"
        />
      ))}
      {bands.length > 1
        ? m.bins.map((_, index) => {
            let offset = 0;
            return bands.map((band, bandIndex) => {
              const value = band.bins[index] ?? 0;
              if (!value) return null;
              const barHeight = value * scale;
              const y = 95 - offset - barHeight;
              offset += barHeight;
              return (
                <rect
                  key={`${band.bandId}-${index}`}
                  x={(index * width) / m.bins.length}
                  y={y}
                  width={Math.max(1, width / m.bins.length - 1)}
                  height={barHeight}
                  fill={PALETTE[bandIndex % PALETTE.length]}
                  opacity=".85"
                />
              );
            });
          })
        : m.bins.map((value, index) => (
            <rect
              key={index}
              x={(index * width) / m.bins.length}
              y={95 - value * scale}
              width={Math.max(1, width / m.bins.length - 1)}
              height={value * scale}
              fill="#b5eb78"
              opacity=".8"
            />
          ))}
      <line
        x1={width / 2}
        x2={width / 2}
        y1="0"
        y2="100"
        stroke="#637b8c"
        strokeDasharray="3 5"
      />
    </svg>
  );
}

export function BandLegend({ measurement: m }: { measurement: Measurement }) {
  if (m.bands.length <= 1) return null;
  return (
    <div className="band-legend">
      {m.bands.map((band, index) => (
        <span key={band.bandId}>
          <i style={{ background: PALETTE[index % PALETTE.length] }} />
          {band.label} · {band.received.toFixed(3)} W
        </span>
      ))}
    </div>
  );
}
