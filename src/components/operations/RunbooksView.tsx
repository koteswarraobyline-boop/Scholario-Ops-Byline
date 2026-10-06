import React, { useEffect, useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { Runbook } from '../../types';
import { CheckCircle2, Square, Plus, Pencil, Trash2, RotateCcw, X, BookOpen, Loader2 } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

const CATEGORIES: Runbook['category'][] = ['DATABASE', 'FAILOVER', 'WEB_SERVER', 'PERFORMANCE', 'DEAD_MAN'];

const fmtDateTime = (iso?: string) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toLocaleString();
};

interface StepDraft { title: string; instruction: string; command: string }
interface RunbookDraft {
  title: string;
  description: string;
  category: Runbook['category'];
  estimatedDurationMin: number;
  steps: StepDraft[];
}

const emptyDraft = (): RunbookDraft => ({
  title: '', description: '', category: 'WEB_SERVER', estimatedDurationMin: 15,
  steps: [{ title: '', instruction: '', command: '' }],
});

const RunbookEditor: React.FC<{
  initial: RunbookDraft;
  isNew: boolean;
  onCancel: () => void;
  onSave: (draft: RunbookDraft) => Promise<boolean>;
}> = ({ initial, isNew, onCancel, onSave }) => {
  const { theme } = useOps();
  const isDark = theme === 'dark';
  const [draft, setDraft] = useState<RunbookDraft>(initial);
  const [saving, setSaving] = useState(false);

  const inputCls = `w-full p-2 border rounded text-xs font-mono focus:outline-none focus:border-blue-500 ${
    isDark ? 'bg-[#0A0F1A] border-[#1E293B] text-slate-100' : 'bg-white border-slate-300 text-slate-900'
  }`;
  const labelCls = `block text-[10px] uppercase font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const secondaryBtn = `px-2.5 py-1 rounded text-[11px] font-semibold border cursor-pointer disabled:opacity-50 ${
    isDark ? 'bg-[#1A2436] hover:bg-[#23324C] border-[#23334E] text-slate-200' : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
  }`;

  const setStep = (i: number, patch: Partial<StepDraft>) =>
    setDraft(d => ({ ...d, steps: d.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  const moveStep = (i: number, dir: -1 | 1) =>
    setDraft(d => {
      const j = i + dir;
      if (j < 0 || j >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...d, steps };
    });

  const valid = draft.title.trim() && draft.steps.length > 0 && draft.steps.every(s => s.title.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className={`md:col-span-3 rounded-lg border p-5 space-y-4 font-mono text-xs ${
      isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
    }`}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-sm">{isNew ? 'New runbook' : 'Edit runbook'}</span>
        <button type="button" onClick={onCancel} className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      {!isNew && (
        <p className={`font-sans text-[11px] ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
          Saving resets step progress for this runbook.
        </p>
      )}

      <div>
        <label className={labelCls}>Title *</label>
        <input className={inputCls} required maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <textarea className={inputCls} rows={2} maxLength={2000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Category</label>
          <select className={inputCls} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value as Runbook['category'] })}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Estimated duration (min)</label>
          <input
            type="number" min={1} max={1440} className={inputCls}
            value={draft.estimatedDurationMin}
            onChange={e => setDraft({ ...draft, estimatedDurationMin: Math.max(1, Math.min(1440, Math.floor(Number(e.target.value) || 1))) })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className={labelCls}>Steps *</div>
        {draft.steps.map((s, i) => (
          <div key={i} className={`p-3 rounded border space-y-2 ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">Step {i + 1}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className={secondaryBtn}>↑</button>
                <button type="button" onClick={() => moveStep(i, 1)} disabled={i === draft.steps.length - 1} className={secondaryBtn}>↓</button>
                <button
                  type="button"
                  onClick={() => setDraft(d => ({ ...d, steps: d.steps.filter((_, idx) => idx !== i) }))}
                  disabled={draft.steps.length <= 1}
                  className={`${secondaryBtn} text-rose-500`}
                >
                  Remove
                </button>
              </div>
            </div>
            <input className={inputCls} placeholder="Step title *" maxLength={200} value={s.title} onChange={e => setStep(i, { title: e.target.value })} />
            <textarea className={inputCls} rows={2} placeholder="Instruction" maxLength={4000} value={s.instruction} onChange={e => setStep(i, { instruction: e.target.value })} />
            <input className={inputCls} placeholder="Command (optional)" maxLength={2000} value={s.command} onChange={e => setStep(i, { command: e.target.value })} />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setDraft(d => ({ ...d, steps: [...d.steps, { title: '', instruction: '', command: '' }] }))}
          disabled={draft.steps.length >= 50}
          className={`${secondaryBtn} flex items-center gap-1`}
        >
          <Plus className="w-3 h-3" /> Add step
        </button>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryBtn}>Cancel</button>
        <button
          type="submit"
          disabled={!valid || saving}
          className="px-3 py-1 rounded text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer"
        >
          {saving ? 'Saving…' : isNew ? 'Create runbook' : 'Save runbook'}
        </button>
      </div>
    </form>
  );
};

export const RunbooksView: React.FC = () => {
  const {
    runbooks, selectedRunbookId, setSelectedRunbookId, toggleRunbookStep, resetRunbook,
    createRunbook, updateRunbook, deleteRunbook, theme,
  } = useOps();
  const { hasRole } = useAuth();
  const isDark = theme === 'dark';
  const isAdmin = hasRole('it_administrator');
  const isOperator = hasRole('operator');

  const [activeRbId, setActiveRbId] = useState<string>(selectedRunbookId || '');
  const [editing, setEditing] = useState<{ id: string | null; draft: RunbookDraft } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (selectedRunbookId) setActiveRbId(selectedRunbookId);
  }, [selectedRunbookId]);

  const currentRunbook = runbooks.find(r => r.id === activeRbId) || runbooks[0];

  const selectRunbook = (id: string) => {
    setActiveRbId(id);
    setSelectedRunbookId(id);
    setConfirmDelete(false);
  };

  const withBusy = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  };

  const saveDraft = async (draft: RunbookDraft): Promise<boolean> => {
    const payload: Partial<Runbook> = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      category: draft.category,
      estimatedDurationMin: draft.estimatedDurationMin,
      steps: draft.steps.map((s, i) => ({
        id: i + 1,
        title: s.title.trim(),
        instruction: s.instruction.trim(),
        command: s.command.trim() || undefined,
        completed: false,
      })),
    };
    const rb = editing?.id ? await updateRunbook(editing.id, payload) : await createRunbook(payload);
    if (rb) {
      setEditing(null);
      selectRunbook(rb.id);
      return true;
    }
    return false;
  };

  const header = (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
      isDark ? 'border-[#1E293B]' : 'border-slate-200'
    }`}>
      <div>
        <h1 className="text-lg font-bold font-mono tracking-tight">
          OPERATIONAL RUNBOOKS
        </h1>
        <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Step-by-step procedures; operators check off steps as they work an incident
        </p>
      </div>
      {isAdmin && !editing && (
        <button
          onClick={() => setEditing({ id: null, draft: emptyDraft() })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New runbook</span>
        </button>
      )}
    </div>
  );

  if (runbooks.length === 0 && !editing) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={BookOpen}
          title="No runbooks yet"
          description={isAdmin
            ? 'Write your first runbook: the steps your team follows for a database outage, failover or web server failure. Link it to monitors so incidents carry it.'
            : 'An IT administrator has not created any runbooks yet.'}
          action={isAdmin ? { label: 'New runbook', onClick: () => setEditing({ id: null, draft: emptyDraft() }) } : undefined}
        />
      </div>
    );
  }

  const secondaryBtn = `px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1 border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
    isDark ? 'bg-[#1A2436] hover:bg-[#23324C] border-[#23334E] text-slate-200' : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
  }`;

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">

        {/* Left list */}
        <div className="space-y-2">
          <div className={`text-[10px] font-semibold uppercase tracking-wider font-mono px-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Runbooks ({runbooks.length})
          </div>
          {runbooks.map(rb => {
            const completedCount = rb.steps.filter(s => s.completed).length;
            const isSelected = !editing && rb.id === currentRunbook?.id;

            return (
              <button
                key={rb.id}
                onClick={() => { setEditing(null); selectRunbook(rb.id); }}
                className={`w-full text-left p-3 rounded-lg border transition-all text-xs space-y-1 font-mono cursor-pointer ${
                  isSelected
                    ? 'bg-blue-600 text-white font-medium shadow-xs'
                    : isDark
                      ? 'bg-[#111726] border-[#1E293B] text-slate-400 hover:text-slate-200'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 shadow-xs'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold ${isSelected ? 'text-blue-100' : 'text-blue-500'}`}>{rb.category}</span>
                  <span className={`text-[10px] ${isSelected ? 'text-blue-100' : (isDark ? 'text-slate-500' : 'text-slate-400')}`}>~{rb.estimatedDurationMin}m</span>
                </div>
                <div className={`font-semibold line-clamp-1 font-sans ${isSelected ? 'text-white' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>{rb.title}</div>
                <div className={`flex items-center justify-between text-[11px] pt-1 ${isSelected ? 'text-blue-100' : (isDark ? 'text-slate-400' : 'text-slate-500')}`}>
                  <span>Progress:</span>
                  <span className={completedCount === rb.steps.length && rb.steps.length > 0 ? (isSelected ? 'text-emerald-200 font-bold' : 'text-emerald-500 font-bold') : (isSelected ? 'text-white' : 'text-blue-500')}>
                    {completedCount} / {rb.steps.length} steps
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {editing ? (
          <RunbookEditor
            key={editing.id ?? 'new'}
            initial={editing.draft}
            isNew={!editing.id}
            onCancel={() => setEditing(null)}
            onSave={saveDraft}
          />
        ) : currentRunbook && (
          <div className={`md:col-span-3 rounded-lg border p-5 space-y-5 transition-colors ${
            isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
          }`}>
            <div className={`border-b pb-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3 font-mono ${
              isDark ? 'border-[#1A2332]' : 'border-slate-100'
            }`}>
              <div className="min-w-0">
                <span className={`text-xs uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Category: {currentRunbook.category} · ~{currentRunbook.estimatedDurationMin} min
                </span>
                <h2 className="text-base font-bold font-sans mt-0.5">{currentRunbook.title}</h2>
                {currentRunbook.description && (
                  <p className={`text-xs font-sans mt-0.5 whitespace-pre-wrap ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{currentRunbook.description}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {isOperator && (
                  <button
                    onClick={() => withBusy('reset', () => resetRunbook(currentRunbook.id))}
                    disabled={busy !== null || !currentRunbook.steps.some(s => s.completed)}
                    className={secondaryBtn}
                  >
                    <RotateCcw className={`w-3 h-3 ${busy === 'reset' ? 'animate-spin' : ''}`} />
                    <span>Reset progress</span>
                  </button>
                )}
                {isAdmin && !confirmDelete && (
                  <>
                    <button
                      onClick={() => setEditing({
                        id: currentRunbook.id,
                        draft: {
                          title: currentRunbook.title,
                          description: currentRunbook.description ?? '',
                          category: currentRunbook.category,
                          estimatedDurationMin: currentRunbook.estimatedDurationMin,
                          steps: currentRunbook.steps.map(s => ({ title: s.title, instruction: s.instruction ?? '', command: s.command ?? '' })),
                        },
                      })}
                      disabled={busy !== null}
                      className={secondaryBtn}
                    >
                      <Pencil className="w-3 h-3" /><span>Edit</span>
                    </button>
                    <button onClick={() => setConfirmDelete(true)} disabled={busy !== null} className={`${secondaryBtn} text-rose-500`}>
                      <Trash2 className="w-3 h-3" /><span>Delete</span>
                    </button>
                  </>
                )}
                {isAdmin && confirmDelete && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-rose-500">Delete this runbook?</span>
                    <button
                      onClick={() => withBusy('delete', async () => {
                        if (await deleteRunbook(currentRunbook.id)) {
                          setConfirmDelete(false);
                          setActiveRbId('');
                          setSelectedRunbookId(null);
                        }
                      })}
                      disabled={busy !== null}
                      className="px-2.5 py-1 rounded font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white cursor-pointer"
                    >
                      {busy === 'delete' ? 'Deleting…' : 'Delete'}
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className={secondaryBtn}>Cancel</button>
                  </div>
                )}
              </div>
            </div>

            {!isOperator && (
              <p className={`text-[11px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Read-only: operators and above can check off steps.</p>
            )}

            <div className="space-y-3 font-mono text-xs">
              {currentRunbook.steps.length === 0 && (
                <div className={`p-4 text-center ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>This runbook has no steps.</div>
              )}
              {currentRunbook.steps.map(step => {
                const stepKey = `step:${step.id}`;
                const completedAt = fmtDateTime(step.completedAt);
                const canToggle = isOperator && busy === null;
                return (
                  <div
                    key={step.id}
                    onClick={() => { if (canToggle) void withBusy(stepKey, () => toggleRunbookStep(currentRunbook.id, step.id)); }}
                    className={`p-3.5 rounded border transition-all ${canToggle ? 'cursor-pointer' : isOperator ? 'cursor-wait' : 'cursor-default'} ${
                      step.completed
                        ? (isDark ? 'bg-[#0E1A14] border-emerald-900/60' : 'bg-emerald-50 border-emerald-300')
                        : (isDark ? 'bg-[#0B0F17] border-[#1A2436] hover:border-slate-700' : 'bg-slate-50 border-slate-200 hover:border-slate-300')
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        {busy === stepKey ? (
                          <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                        ) : step.completed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <Square className={`w-4 h-4 ${isDark ? 'text-slate-600' : 'text-slate-400'}`} />
                        )}
                      </div>

                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                          <span className={`font-bold ${step.completed ? 'text-emerald-600 line-through' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>
                            Step {step.id}: {step.title}
                          </span>
                          {step.completed && (completedAt || step.completedBy) && (
                            <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                              Done{completedAt ? ` ${completedAt}` : ''}{step.completedBy ? ` by ${step.completedBy}` : ''}
                            </span>
                          )}
                        </div>

                        {step.instruction && (
                          <p className={`font-sans text-xs whitespace-pre-wrap ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{step.instruction}</p>
                        )}

                        {step.command && (
                          <div
                            onClick={e => e.stopPropagation()}
                            className={`mt-2 p-2 rounded border text-[11px] overflow-x-auto min-w-0 cursor-text ${
                              isDark ? 'bg-[#05080E] text-slate-200 border-[#182338]' : 'bg-slate-900 text-slate-100 border-slate-800'
                            }`}
                          >
                            <code className="whitespace-pre font-mono select-all">$ {step.command}</code>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
