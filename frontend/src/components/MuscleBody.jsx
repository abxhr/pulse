// Simplified front/back body silhouettes with muscle regions colored by this
// week's training volume - a lightweight stand-in for Hevy's muscle heatmap.
import { COLORS, mix } from "../lib/format";

const HEAT = COLORS.strength;
const NEUTRAL = "var(--color-line)";

function heatFill(intensity) {
  if (!intensity) return NEUTRAL;
  const alpha = 0.18 + intensity * 0.72; // 0.18 .. 0.9
  return mix(HEAT, Math.round(alpha * 100));
}

function Region({ d, cx, cy, rx, ry, intensity, label, onHover }) {
  const fill = heatFill(intensity);
  const shared = {
    fill, stroke: "var(--color-line)", strokeWidth: 1, className: "transition-colors duration-300 cursor-default",
    onMouseEnter: () => onHover?.(label, intensity),
    onMouseLeave: () => onHover?.(null),
  };
  return d
    ? <path d={d} {...shared} />
    : <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...shared} />;
}

export default function MuscleBody({ intensities = {}, onHover }) {
  const i = (muscle) => intensities[muscle] || 0;

  return (
    <div className="flex items-center justify-center gap-6">
      {/* FRONT */}
      <svg viewBox="0 0 200 320" className="h-72 w-auto">
        <circle cx="100" cy="26" r="16" fill="var(--color-line)" />
        <rect x="92" y="40" width="16" height="14" rx="4" fill="var(--color-line)" />
        {/* shoulders */}
        <Region cx="70" cy="66" rx="15" ry="12" intensity={i("shoulders")} label="Shoulders" onHover={onHover} />
        <Region cx="130" cy="66" rx="15" ry="12" intensity={i("shoulders")} label="Shoulders" onHover={onHover} />
        {/* chest */}
        <Region d="M78,58 L122,58 L124,100 Q100,112 76,100 Z" intensity={i("chest")} label="Chest" onHover={onHover} />
        {/* core */}
        <Region d="M80,102 L120,102 L116,158 Q100,166 84,158 Z" intensity={i("core")} label="Core" onHover={onHover} />
        {/* biceps */}
        <Region d="M52,68 L68,64 L66,112 L50,110 Z" intensity={i("biceps")} label="Biceps" onHover={onHover} />
        <Region d="M148,68 L132,64 L134,112 L150,110 Z" intensity={i("biceps")} label="Biceps" onHover={onHover} />
        {/* forearms (not tracked - neutral) */}
        <Region d="M49,112 L64,114 L60,152 L47,150 Z" intensity={0} label="Forearms" onHover={onHover} />
        <Region d="M151,112 L136,114 L140,152 L153,150 Z" intensity={0} label="Forearms" onHover={onHover} />
        {/* quads */}
        <Region d="M82,162 L98,162 L96,238 L80,238 Z" intensity={i("quadriceps")} label="Quadriceps" onHover={onHover} />
        <Region d="M118,162 L102,162 L104,238 L120,238 Z" intensity={i("quadriceps")} label="Quadriceps" onHover={onHover} />
        {/* shins (neutral) */}
        <Region d="M82,242 L96,242 L94,296 L83,296 Z" intensity={0} label="Shins" onHover={onHover} />
        <Region d="M118,242 L104,242 L106,296 L117,296 Z" intensity={0} label="Shins" onHover={onHover} />
      </svg>

      {/* BACK */}
      <svg viewBox="0 0 200 320" className="h-72 w-auto">
        <circle cx="100" cy="26" r="16" fill="var(--color-line)" />
        <rect x="92" y="40" width="16" height="14" rx="4" fill="var(--color-line)" />
        <Region cx="70" cy="66" rx="15" ry="12" intensity={i("shoulders")} label="Shoulders" onHover={onHover} />
        <Region cx="130" cy="66" rx="15" ry="12" intensity={i("shoulders")} label="Shoulders" onHover={onHover} />
        {/* back / lats */}
        <Region d="M78,58 L122,58 L120,140 Q100,150 80,140 Z" intensity={i("back")} label="Back" onHover={onHover} />
        {/* triceps */}
        <Region d="M52,68 L68,64 L66,112 L50,110 Z" intensity={i("triceps")} label="Triceps" onHover={onHover} />
        <Region d="M148,68 L132,64 L134,112 L150,110 Z" intensity={i("triceps")} label="Triceps" onHover={onHover} />
        {/* forearms (neutral) */}
        <Region d="M49,112 L64,114 L60,152 L47,150 Z" intensity={0} label="Forearms" onHover={onHover} />
        <Region d="M151,112 L136,114 L140,152 L153,150 Z" intensity={0} label="Forearms" onHover={onHover} />
        {/* glutes */}
        <Region d="M80,142 L120,142 L118,168 Q100,176 82,168 Z" intensity={i("glutes")} label="Glutes" onHover={onHover} />
        {/* hamstrings */}
        <Region d="M82,170 L98,170 L96,238 L80,238 Z" intensity={i("hamstrings")} label="Hamstrings" onHover={onHover} />
        <Region d="M118,170 L102,170 L104,238 L120,238 Z" intensity={i("hamstrings")} label="Hamstrings" onHover={onHover} />
        {/* calves */}
        <Region d="M82,242 L96,242 L93,296 L84,296 Z" intensity={i("calves")} label="Calves" onHover={onHover} />
        <Region d="M118,242 L104,242 L107,296 L116,296 Z" intensity={i("calves")} label="Calves" onHover={onHover} />
      </svg>
    </div>
  );
}
