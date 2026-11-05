import { useEffect, useRef } from "react";

const stops = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];

function colour(t) {
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f));
}

export default function Spectrogram({ data }) {
  const ref = useRef(null);
  useEffect(() => {
    const rows = data.values.length;
    const cols = data.values[0].length;
    const canvas = ref.current;
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(cols, rows);
    const span = data.max - data.min || 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const [R, G, B] = colour((data.values[rows - 1 - r][c] - data.min) / span);
        const o = (r * cols + c) * 4;
        img.data.set([R, G, B, 255], o);
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [data]);

  return (
    <div>
      <canvas ref={ref} className="spectro" aria-label="Spectrogram" />
      <div className="row between small muted"><span>0 s</span><span>{data.duration.toFixed(0)} s</span></div>
      <div className="small muted">Pitch runs from low (bottom) to {Math.round(data.fmax / 1000)} kHz (top). Brighter means louder.</div>
    </div>
  );
}
