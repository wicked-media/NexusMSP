const TERMINAL_STATUSES = new Set(["ok", "error", "timeout", "cancelled"]);

export function canExecuteAgentCommands(user) {
  const role = String(user?.role || "").toLowerCase();
  return Boolean(
    user?.is_admin
    || role === "admin"
    || role === "owner"
    || user?.permissions?.agent_commands?.execute
  );
}

export function updateFilteredSelection(previous, filteredIds) {
  const next = new Set(previous);
  const allSelected = filteredIds.length > 0 && filteredIds.every(id => next.has(id));
  if (allSelected) filteredIds.forEach(id => next.delete(id));
  else filteredIds.forEach(id => next.add(id));
  return next;
}

export function batchIsComplete(commands) {
  return commands.length > 0 && commands.every(command => TERMINAL_STATUSES.has(command.status));
}
