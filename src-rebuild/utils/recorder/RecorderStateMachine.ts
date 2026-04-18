function canStartRecording(state) {
  return state === "ready";
}
function canPauseToggle(state) {
  return state === "recording" || state === "paused";
}
function canStopRecording(state) {
  return state === "recording" || state === "paused";
}
function canUploadAudio(state) {
  return state === "ready";
}
function canEditSaveAudio(state) {
  return state === "ready";
}
