import CoachChat from "../components/coach/CoachChat";
import Briefing from "../components/coach/Briefing";
import RaceReadiness from "../components/RaceReadiness";
import { Injuries, Memory } from "../components/coach/CoachSide";

export default function Insights({ aiStatus }) {
  const noKey = aiStatus && !aiStatus.anthropic && !aiStatus.openai;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-label="Coach conversation" className="flex h-[calc(100vh-8.5rem)] min-h-[34rem] min-w-0 flex-col rounded-xl bg-panel">
        {noKey && <p role="alert" className="m-4 rounded-xl bg-effort/10 px-4 py-3 text-sm text-effort">No AI key is configured. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env and restart the server.</p>}
        <CoachChat page="coach" listen top={<Briefing />} />
      </section>
      <aside className="space-y-4">
        <RaceReadiness />
        <Injuries />
        <Memory />
      </aside>
    </div>
  );
}
