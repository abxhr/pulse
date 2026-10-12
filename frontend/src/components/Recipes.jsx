import { useEffect, useState } from "react";
import { Plus, X, Sparkles, Camera, Link as LinkIcon, Type, Trash2, ChevronDown, UtensilsCrossed } from "lucide-react";
import { api } from "../lib/api";
import { COLORS, fmtNum } from "../lib/format";
import { Panel, Chip, Loading } from "./primitives";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];
const SOURCE_LABEL = { screenshot: "photo", youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", text: "text" };

function AddRecipe({ onSaved, aiStatus }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("screenshot"); // screenshot | url | text
  const [files, setFiles] = useState([]);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [provider, setProvider] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [extracted, setExtracted] = useState(null);

  const providerOptions = [
    { id: null, label: "Auto" },
    { id: "anthropic", label: "Claude", ok: aiStatus?.anthropic },
    { id: "openai", label: "GPT", ok: aiStatus?.openai },
  ];

  function reset() {
    setFiles([]); setUrl(""); setText(""); setExtracted(null); setError(null);
    setMode("screenshot"); setOpen(false);
  }

  async function extract() {
    setBusy(true); setError(null);
    try {
      const est = await api.extractRecipe(
        mode === "screenshot" ? files : [],
        mode === "url" ? url.trim() : null,
        mode === "text" ? text.trim() : null,
        provider,
      );
      setExtracted(est);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await api.saveRecipe(extracted);
      reset();
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  function updateField(k, v) {
    setExtracted((e) => ({ ...e, [k]: v }));
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-panel2 px-4 py-3.5 text-sm font-medium text-muted transition hover:border-nutrition/40 hover:text-nutrition">
        <Plus size={16} /> Save a recipe
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl bg-panel2 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted">New recipe</span>
        <button onClick={reset} className="text-faint hover:text-txt"><X size={16} /></button>
      </div>

      {!extracted ? (
        <>
          <div className="flex gap-1 rounded-full bg-ink p-0.5">
            {[["screenshot", "Photos", Camera], ["url", "URL", LinkIcon], ["text", "Text", Type]].map(([m, label, Icon]) => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  mode === m ? "bg-nutrition text-ink" : "text-muted"
                }`}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          {mode === "screenshot" && (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-ink px-4 py-6 text-center transition hover:border-nutrition/40">
              {files.length ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {files.map((f, i) => (
                    <img key={i} src={URL.createObjectURL(f)} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  ))}
                </div>
              ) : (
                <>
                  <Camera size={22} className="text-faint" />
                  <span className="text-xs text-muted">Add one or more screenshots of the recipe</span>
                </>
              )}
              <input type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            </label>
          )}

          {mode === "url" && (
            <div>
              <input aria-label="YouTube, TikTok, or Instagram Reel URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube, TikTok, or Instagram Reel URL"
                className="w-full rounded-lg border border-line bg-ink px-3 py-2.5 text-sm text-txt placeholder:text-faint focus:border-nutrition/50 focus:outline-none" />
              <p className="mt-1.5 text-xs text-faint">Instagram is best-effort - if it can't read the caption, paste it in via the Text tab instead. YouTube and TikTok are reliable.</p>
            </div>
          )}

          {mode === "text" && (
            <textarea aria-label="Paste the recipe, a caption, or ingredient list here" value={text} onChange={(e) => setText(e.target.value)} rows={5}
              placeholder="Paste the recipe, a caption, or ingredient list here"
              className="w-full resize-none rounded-lg border border-line bg-ink px-3 py-2.5 text-sm text-txt placeholder:text-faint focus:border-nutrition/50 focus:outline-none" />
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-faint">AI model</span>
            <div className="flex gap-1 rounded-full bg-ink p-0.5">
              {providerOptions.map((o) => (
                <button key={o.label} onClick={() => setProvider(o.id)} disabled={o.id && o.ok === false}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-30 ${
                    provider === o.id ? "bg-nutrition text-ink" : "text-muted"
                  }`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-effort">{error}</p>}

          <button onClick={extract} disabled={busy || (mode === "screenshot" ? !files.length : mode === "url" ? !url.trim() : !text.trim())}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-nutrition py-2.5 text-sm font-semibold text-ink transition disabled:opacity-50">
            <Sparkles size={15} /> {busy ? "Reading recipe…" : "Extract recipe"}
          </button>
        </>
      ) : (
        <>
          <div className="rounded-lg border border-nutrition/30 bg-nutrition/10 px-3 py-2 text-xs text-nutrition">
            {extracted.confidence || "medium"} confidence{extracted.notes ? ` - ${extracted.notes}` : ""}. Review before saving.
          </div>
          <input aria-label="Recipe name" value={extracted.name || ""} onChange={(e) => updateField("name", e.target.value)}
            className="w-full rounded-lg border border-line bg-ink px-3 py-2.5 text-sm text-txt focus:border-nutrition/50 focus:outline-none" />
          <div className="grid grid-cols-5 gap-2">
            {[["servings", ""], ["calories", "kcal"], ["protein_g", "protein g"], ["carbs_g", "carbs g"], ["fat_g", "fat g"]].map(([k, unit]) => (
              <div key={k}>
                <input aria-label="Amount" inputMode="decimal" value={extracted[k] ?? ""} onChange={(e) => updateField(k, e.target.value ? Number(e.target.value) : null)}
                  className="w-full rounded-lg border border-line bg-ink px-2 py-2 text-center text-sm text-txt focus:border-nutrition/50 focus:outline-none" />
                <div className="mt-0.5 text-center text-xs text-faint">{unit || "servings"}</div>
              </div>
            ))}
          </div>
          {extracted.ingredients?.length > 0 && (
            <div className="rounded-lg border border-line bg-ink px-3 py-2 text-xs text-muted">
              {extracted.ingredients.map((ing, i) => <div key={i}>• {ing}</div>)}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setExtracted(null)} className="flex-1 rounded-lg border border-line py-2.5 text-sm text-muted">Back</button>
            <button onClick={save} disabled={busy || !extracted.name}
              className="flex-1 rounded-lg bg-nutrition py-2.5 text-sm font-semibold text-ink disabled:opacity-50">
              {busy ? "Saving…" : "Save recipe"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RecipeCard({ r, onChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [logging, setLogging] = useState(false);

  async function logAsMeal(mealType) {
    setLogging(true);
    try {
      await api.logRecipeAsMeal(r.id, { servings_eaten: 1, meal_type: mealType });
      onChanged();
    } finally {
      setLogging(false);
    }
  }
  async function remove() {
    await api.deleteRecipe(r.id);
    onChanged();
  }

  return (
    <div className="rounded-lg bg-panel2 p-3">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => setExpanded((e) => !e)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown size={14} className={`shrink-0 text-faint transition-transform ${expanded ? "rotate-180" : ""}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-txt">{r.name}</span>
              {r.source_type && <Chip color={COLORS.nutrition}>{SOURCE_LABEL[r.source_type] || r.source_type}</Chip>}
            </div>
            <div className="mt-0.5 font-mono text-xs text-faint tnum">
              {fmtNum(r.calories)} kcal · P{fmtNum(r.protein_g)} · C{fmtNum(r.carbs_g)} · F{fmtNum(r.fat_g)} · per serving ({r.servings} servings)
            </div>
          </div>
        </button>
        <button onClick={remove} className="shrink-0 text-faint hover:text-effort"><Trash2 size={14} /></button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {r.ingredients?.length > 0 && (
            <div className="text-xs text-muted">{r.ingredients.map((ing, i) => <div key={i}>• {ing}</div>)}</div>
          )}
          {r.instructions && <p className="text-xs text-faint">{r.instructions}</p>}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {MEAL_TYPES.map((t) => (
              <button key={t} onClick={() => logAsMeal(t)} disabled={logging}
                className="flex items-center gap-1 rounded-full bg-panel px-2.5 py-1 text-xs capitalize text-muted transition hover:bg-nutrition hover:text-ink disabled:opacity-50">
                <UtensilsCrossed size={11} /> Log as {t}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Recipes({ aiStatus }) {
  const [list, setList] = useState(null);
  const refresh = () => { api.recipes().then(setList).catch(() => setList([])); };
  useEffect(refresh, []);

  return (
    <Panel accent={COLORS.nutrition} title="Saved recipes" sub={list?.length ? `${list.length} saved` : "none yet"}>
      <div className="space-y-3">
        <AddRecipe onSaved={refresh} aiStatus={aiStatus} />
        {list === null ? <Loading label="Loading recipes…" /> : (
          list.length === 0
            ? <p className="py-4 text-center text-xs text-faint">Save your first recipe above, or from a Coach answer.</p>
            : <div className="space-y-2">{list.map((r) => <RecipeCard key={r.id} r={r} onChanged={refresh} />)}</div>
        )}
      </div>
    </Panel>
  );
}
