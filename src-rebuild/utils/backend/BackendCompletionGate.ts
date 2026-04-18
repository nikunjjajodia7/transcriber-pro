function isCompletedStatus(statusRaw) {
  const status = (statusRaw || "").trim().toLowerCase();
  return status === "completed" || status === "succeeded" || status === "done";
}
function isFailedTerminalStatus(statusRaw) {
  const status = (statusRaw || "").trim().toLowerCase();
  return status === "failed" || status === "error" || status === "canceled";
}
