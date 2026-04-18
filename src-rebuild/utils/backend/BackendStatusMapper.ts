var UI_RANK = {
  creating: 0,
  uploading: 1,
  queued: 2,
  processing: 3,
  completed: 4,
  failed: 4
};
function mapBackendToUiState(statusRaw, stageRaw) {
  const status = (statusRaw || "").trim().toLowerCase();
  const stage = (stageRaw || "").trim().toLowerCase();
  const probe = `${status} ${stage}`;
  if (status === "failed" || status === "error" || status === "canceled")
    return "failed";
  if (status === "completed" || status === "done" || status === "succeeded")
    return "completed";
  if (probe.includes("upload"))
    return "uploading";
  if (probe.includes("creat"))
    return "creating";
  if (probe.includes("queue"))
    return "queued";
  if (probe.includes("process") || probe.includes("provider"))
    return "processing";
  if (status === "created")
    return "creating";
  if (status === "uploaded")
    return "uploading";
  return "processing";
}
function clampMonotonicUiState(previous, next) {
  if (!previous)
    return next;
  if (previous === "failed" || previous === "completed")
    return previous;
  if (next === "failed" || next === "completed")
    return next;
  return UI_RANK[next] >= UI_RANK[previous] ? next : previous;
}
function formatUiStateLabel(state) {
  switch (state) {
    case "creating":
      return "Creating job";
    case "uploading":
      return "Uploading source";
    case "queued":
      return "Queued";
    case "processing":
      return "Processing";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Processing";
  }
}
