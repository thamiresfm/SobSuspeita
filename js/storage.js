const PREFIX = "arquivo-frio:";

function key(caseId, part) {
  return `${PREFIX}${caseId}:${part}`;
}

export function loadCaseState(caseId) {
  const raw = localStorage.getItem(key(caseId, "state"));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveCaseState(caseId, state) {
  localStorage.setItem(key(caseId, "state"), JSON.stringify(state));
}

export function clearCaseState(caseId) {
  localStorage.removeItem(key(caseId, "state"));
}

export function mergeDefaultState(caseId, defaults) {
  const prev = loadCaseState(caseId);
  if (!prev) return { ...defaults };
  return {
    ...defaults,
    ...prev,
    notes: Array.isArray(prev.notes) ? prev.notes : defaults.notes,
    timelineOrder: Array.isArray(prev.timelineOrder) ? prev.timelineOrder : defaults.timelineOrder,
    suspectStatus: typeof prev.suspectStatus === "object" && prev.suspectStatus !== null
      ? prev.suspectStatus
      : defaults.suspectStatus,
  };
}
