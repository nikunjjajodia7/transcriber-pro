export function canStartRecording(state: any) {
  return state === "ready";
}
export function canPauseToggle(state: any) {
  return state === "recording" || state === "paused";
}
export function canStopRecording(state: any) {
  return state === "recording" || state === "paused";
}
export function canUploadAudio(state: any) {
  return state === "ready";
}
export function canEditSaveAudio(state: any) {
  return state === "ready";
}
