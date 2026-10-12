// Anatomical front/back muscle map (react-body-highlighter), shaded by this
// week's training volume. Click a muscle for its numbers.
import Model from "react-body-highlighter";
import { COLORS, mix } from "../lib/format";

// Pulse muscle group -> the library's anatomical regions
const MAP = {
  chest: ["chest"],
  shoulders: ["front-deltoids", "back-deltoids"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  core: ["abs", "obliques"],
  back: ["upper-back", "lower-back", "trapezius"],
  glutes: ["gluteal"],
  quadriceps: ["quadriceps"],
  hamstrings: ["hamstring"],
  calves: ["calves"],
};
const LABEL = Object.fromEntries(Object.keys(MAP).map((k) => [k, k[0].toUpperCase() + k.slice(1)]));
const TIERS = [0.25, 0.4, 0.58, 0.76, 0.95].map((a) => mix(COLORS.strength, Math.round(a * 100)));

export default function MuscleBody({ intensities = {}, onHover }) {
  // the library shades by how many "exercises" hit a muscle, so repeat one per intensity tier
  const data = Object.entries(MAP).flatMap(([group, muscles]) =>
    Array.from({ length: Math.ceil((intensities[group] || 0) * TIERS.length) }, () => ({ name: group, muscles })));

  const onClick = ({ muscle }) => {
    const group = Object.keys(MAP).find((g) => MAP[g].includes(muscle));
    onHover?.(group ? LABEL[group] : null);
  };

  return (
    <div className="flex items-center justify-center gap-4">
      {["anterior", "posterior"].map((type) => (
        <Model key={type} type={type} data={data} onClick={onClick}
          highlightedColors={TIERS} bodyColor="var(--color-line)"
          style={{ width: "10rem" }} svgStyle={{ cursor: "pointer" }} />
      ))}
    </div>
  );
}
