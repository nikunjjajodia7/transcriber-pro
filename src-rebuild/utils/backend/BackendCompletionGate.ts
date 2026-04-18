export function isCompletedStatus(statusRaw: any) {
  const status = (statusRaw || "").trim().toLowerCase();
  return status === "completed" || status === "succeeded" || status === "done";
}
export function isFailedTerminalStatus(statusRaw: any) {
  const status = (statusRaw || "").trim().toLowerCase();
  return status === "failed" || status === "error" || status === "canceled";
}
