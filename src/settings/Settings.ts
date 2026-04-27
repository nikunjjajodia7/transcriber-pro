export var AudioQuality: any = /* @__PURE__ */ ((AudioQuality2: any) => {
  AudioQuality2["Low"] = "low";
  AudioQuality2["Medium"] = "medium";
  AudioQuality2["High"] = "high";
  return AudioQuality2;
})(AudioQuality || {});
export type RecorderMode = 'floating' | 'ribbon' | 'modal';
export var CURRENT_SETTINGS_VERSION = 6;
export var DEFAULT_SETTINGS = {
  settingsVersion: CURRENT_SETTINGS_VERSION,
  // AI Providers
  openaiApiKey: "",
  groqApiKey: "",
  deepgramApiKey: "",
  // Recording
  audioQuality: "medium" /* Medium */,
  recordingFolderPath: "Recordings",
  iphoneInboxFolderPath: "Recordings/Inbox",
  transcriptFolderPath: "Transcripts",
  showFloatingButton: true,
  useRecordingModal: true,
  recorderMode: 'floating' as RecorderMode,
  firstRunRibbonNoticeShown: true,
  micButtonColor: "#4B4B4B",
  transcriptionModel: "whisper-1",
  transcriptionProvider: "openai" /* OpenAI */,
  transcriptionCalloutFormat: ">[!info]- Transcription\n>![[{audioPath}]]\n>{transcription}",
  showTimer: true,
  autoStopEnabled: false,
  autoStopDuration: 5,
  // Post-Processing
  generatePostProcessing: true,
  postProcessingPrompt: "Process the following transcript to extract key insights and information.",
  postProcessingMaxTokens: 500,
  postProcessingModel: "gpt-4o-mini",
  postProcessingProvider: "openai" /* OpenAI */,
  postProcessingTemperature: 0.7,
  postProcessingCalloutFormat: ">[!note]- Post-Processing\n>{postProcessing}",
  // Current Provider
  currentProvider: "openai" /* OpenAI */,
  streamingMode: true,
  // Auto-detected based on device
  includeTimestamps: false,
  enableSpeakerDiarization: false,
  deepgramDetectLanguage: true,
  deepgramLanguageHints: "en,hi",
  forceRomanizedOutput: true,
  deepgramLiveDiarizationProfile: "accuracy_first",
  showLiveChunkPreviewInNote: true,
  saveLiveRecordingAudio: false,
  allowPartialOnStreamFinalizeFailure: true,
  streamTransportFallbackEnabled: true,
  enableBatchChunkingForUploads: true,
  batchChunkThresholdMB: 25,
  batchChunkDurationSec: 360,
  batchChunkOverlapSec: 2,
  allowSingleRequestOverride: true,
  enableBackendOrchestration: false,
  preferBackendForLargeUploads: true,
  backendBaseUrl: "",
  backendApiKey: "",
  backendPollIntervalMs: 3e3,
  backendJobTimeoutSec: 1800,
  backendFailOpenToDirect: true
};
