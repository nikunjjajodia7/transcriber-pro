export function canStartRecording(state) {
  return state === "ready";
}
export function canPauseToggle(state) {
  return state === "recording" || state === "paused";
}
export function canStopRecording(state) {
  return state === "recording" || state === "paused";
}
export function canUploadAudio(state) {
  return state === "ready";
}
export function canEditSaveAudio(state) {
  return state === "ready";
}
