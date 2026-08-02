import { motion } from "framer-motion";

/**
 * The signature element: a luminous radial gauge for today's training readiness,
 * with concentric arcs for body battery and a center readout. Instrument-panel feel.
 */
export default function ReadinessRing({ score = 0, label, bodyBattery, size = 220 }) {
  const stroke = 14;
  const r = (size - stroke) / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score || 0)) / 100;

  // color by readiness band
  const color = score >= 75 ? "#3DD68C" : score >= 50 ? "#38BDF8" : score >= 30 ? "#F5A623" : "#FF5C7A";

  // inner arc: body battery
  const rInner = r - stroke - 6;
  const circInner = 2 * Math.PI * rInner;
  const bb = Math.max(0, Math.min(100, bodyBattery || 0)) / 100;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="block">
        <defs>
          <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.6" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* tick ring */}
        {Array.from({ length: 60 }).map((_, i) => {
          const a = (i / 60) * 2 * Math.PI - Math.PI / 2;
          const rt = r + stroke / 2 + 6;
          const lit = i / 60 <= pct;
          return (
            <line
              key={i}
              x1={cx + Math.cos(a) * rt}
              y1={cy + Math.sin(a) * rt}
              x2={cx + Math.cos(a) * (rt + (i % 5 === 0 ? 6 : 3))}
              y2={cy + Math.sin(a) * (rt + (i % 5 === 0 ? 6 : 3))}
              stroke={lit ? color : "#232a38"}
              strokeWidth={i % 5 === 0 ? 1.6 : 1}
              opacity={lit ? 0.9 : 0.5}
            />
          );
        })}
        {/* track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1c2230" strokeWidth={stroke} />
        {/* readiness arc */}
        <motion.circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="url(#rg)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          filter="url(#glow)"
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - pct) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        {/* body battery inner arc */}
        <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="#1c2230" strokeWidth={5} />
        <motion.circle
          cx={cx}
          cy={cy}
          r={rInner}
          fill="none"
          stroke="#7C83FF"
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circInner}
          initial={{ strokeDashoffset: circInner }}
          animate={{ strokeDashoffset: circInner * (1 - bb) }}
          transition={{ duration: 1.1, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted">Readiness</span>
        <motion.span
          className="font-mono text-5xl font-bold tnum"
          style={{ color }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          {score ?? "—"}
        </motion.span>
        <span className="text-xs font-medium" style={{ color }}>
          {label || ""}
        </span>
        {bodyBattery != null && (
          <span className="mt-1 font-mono text-[11px] text-sleep/90">
            body battery {bodyBattery}
          </span>
        )}
      </div>
    </div>
  );
}
