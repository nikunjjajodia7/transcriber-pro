import { AIProvider } from '../adapters/AIAdapter';
import { AudioQuality, CURRENT_SETTINGS_VERSION, DEFAULT_SETTINGS } from './Settings';

export function migrateAndNormalizeSettings(data) {
  const raw = isRecord(data) ? data : {};
  const sourceVersion = getSourceVersion(raw);
  const warnings = [];
  const migrated = sourceVersion < CURRENT_SETTINGS_VERSION;
  const merged = {
    ...DEFAULT_SETTINGS,
    ...raw
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    settingsVersion: CURRENT_SETTINGS_VERSION,
    audioQuality: asEnum(merged.audioQuality, AudioQuality, DEFAULT_SETTINGS.audioQuality),
    recordingFolderPath: asPath(merged.recordingFolderPath, DEFAULT_SETTINGS.recordingFolderPath),
    iphoneInboxFolderPath: asPath(
      merged.iphoneInboxFolderPath,
      DEFAULT_SETTINGS.iphoneInboxFolderPath
    ),
    transcriptFolderPath: asPath(merged.transcriptFolderPath, DEFAULT_SETTINGS.transcriptFolderPath),
    showFloatingButton: asBoolean(merged.showFloatingButton, DEFAULT_SETTINGS.showFloatingButton),
    useRecordingModal: asBoolean(merged.useRecordingModal, DEFAULT_SETTINGS.useRecordingModal),
    showToolbarButton: false,
    micButtonColor: asString(merged.micButtonColor, DEFAULT_SETTINGS.micButtonColor),
    transcriptionModel: asString(merged.transcriptionModel, DEFAULT_SETTINGS.transcriptionModel),
    transcriptionProvider: asEnum(
      merged.transcriptionProvider,
      AIProvider,
      DEFAULT_SETTINGS.transcriptionProvider
    ),
    transcriptionCalloutFormat: asString(
      merged.transcriptionCalloutFormat,
      DEFAULT_SETTINGS.transcriptionCalloutFormat
    ),
    showTimer: asBoolean(merged.showTimer, DEFAULT_SETTINGS.showTimer),
    autoStopEnabled: asBoolean(merged.autoStopEnabled, DEFAULT_SETTINGS.autoStopEnabled),
    autoStopDuration: asBoundedNumber(
      merged.autoStopDuration,
      DEFAULT_SETTINGS.autoStopDuration,
      1,
      180
    ),
    generatePostProcessing: asBoolean(
      merged.generatePostProcessing,
      DEFAULT_SETTINGS.generatePostProcessing
    ),
    postProcessingPrompt: asString(
      merged.postProcessingPrompt,
      DEFAULT_SETTINGS.postProcessingPrompt
    ),
    postProcessingMaxTokens: asBoundedNumber(
      merged.postProcessingMaxTokens,
      DEFAULT_SETTINGS.postProcessingMaxTokens,
      64,
      16e3
    ),
    postProcessingModel: asString(
      merged.postProcessingModel,
      DEFAULT_SETTINGS.postProcessingModel
    ),
    postProcessingProvider: asEnum(
      merged.postProcessingProvider,
      AIProvider,
      DEFAULT_SETTINGS.postProcessingProvider
    ),
    postProcessingTemperature: asBoundedNumber(
      merged.postProcessingTemperature,
      DEFAULT_SETTINGS.postProcessingTemperature,
      0,
      2
    ),
    postProcessingCalloutFormat: asString(
      merged.postProcessingCalloutFormat,
      DEFAULT_SETTINGS.postProcessingCalloutFormat
    ),
    currentProvider: asEnum(merged.currentProvider, AIProvider, DEFAULT_SETTINGS.currentProvider),
    streamingMode: asBoolean(merged.streamingMode, DEFAULT_SETTINGS.streamingMode),
    includeTimestamps: asBoolean(merged.includeTimestamps, DEFAULT_SETTINGS.includeTimestamps),
    enableSpeakerDiarization: asBoolean(
      merged.enableSpeakerDiarization,
      DEFAULT_SETTINGS.enableSpeakerDiarization
    ),
    deepgramDetectLanguage: asBoolean(
      merged.deepgramDetectLanguage,
      DEFAULT_SETTINGS.deepgramDetectLanguage
    ),
    deepgramLanguageHints: asString(
      merged.deepgramLanguageHints,
      DEFAULT_SETTINGS.deepgramLanguageHints
    ),
    forceRomanizedOutput: asBoolean(
      merged.forceRomanizedOutput,
      DEFAULT_SETTINGS.forceRomanizedOutput
    ),
    deepgramLiveDiarizationProfile: asEnum(
      merged.deepgramLiveDiarizationProfile,
      {
        accuracy_first: "accuracy_first",
        balanced: "balanced",
        low_latency: "low_latency"
      },
      DEFAULT_SETTINGS.deepgramLiveDiarizationProfile
    ),
    showLiveChunkPreviewInNote: asBoolean(
      merged.showLiveChunkPreviewInNote,
      DEFAULT_SETTINGS.showLiveChunkPreviewInNote
    ),
    saveLiveRecordingAudio: asBoolean(
      merged.saveLiveRecordingAudio,
      DEFAULT_SETTINGS.saveLiveRecordingAudio
    ),
    allowPartialOnStreamFinalizeFailure: asBoolean(
      merged.allowPartialOnStreamFinalizeFailure,
      DEFAULT_SETTINGS.allowPartialOnStreamFinalizeFailure
    ),
    streamTransportFallbackEnabled: asBoolean(
      merged.streamTransportFallbackEnabled,
      DEFAULT_SETTINGS.streamTransportFallbackEnabled
    ),
    useExpandableFloatingRecorder: asBoolean(
      merged.useExpandableFloatingRecorder,
      DEFAULT_SETTINGS.useExpandableFloatingRecorder
    ),
    enableBatchChunkingForUploads: asBoolean(
      merged.enableBatchChunkingForUploads,
      DEFAULT_SETTINGS.enableBatchChunkingForUploads
    ),
    batchChunkThresholdMB: asBoundedNumber(
      merged.batchChunkThresholdMB,
      DEFAULT_SETTINGS.batchChunkThresholdMB,
      5,
      512
    ),
    batchChunkDurationSec: asBoundedNumber(
      merged.batchChunkDurationSec,
      DEFAULT_SETTINGS.batchChunkDurationSec,
      30,
      1800
    ),
    batchChunkOverlapSec: asBoundedNumber(
      merged.batchChunkOverlapSec,
      DEFAULT_SETTINGS.batchChunkOverlapSec,
      0,
      30
    ),
    allowSingleRequestOverride: asBoolean(
      merged.allowSingleRequestOverride,
      DEFAULT_SETTINGS.allowSingleRequestOverride
    ),
    enableBackendOrchestration: asBoolean(
      merged.enableBackendOrchestration,
      DEFAULT_SETTINGS.enableBackendOrchestration
    ),
    preferBackendForLargeUploads: asBoolean(
      merged.preferBackendForLargeUploads,
      DEFAULT_SETTINGS.preferBackendForLargeUploads
    ),
    backendBaseUrl: asString(merged.backendBaseUrl, DEFAULT_SETTINGS.backendBaseUrl),
    backendApiKey: asString(merged.backendApiKey, DEFAULT_SETTINGS.backendApiKey),
    backendPollIntervalMs: asBoundedNumber(
      merged.backendPollIntervalMs,
      DEFAULT_SETTINGS.backendPollIntervalMs,
      1e3,
      3e4
    ),
    backendJobTimeoutSec: asBoundedNumber(
      merged.backendJobTimeoutSec,
      DEFAULT_SETTINGS.backendJobTimeoutSec,
      60,
      14400
    ),
    backendFailOpenToDirect: asBoolean(
      merged.backendFailOpenToDirect,
      DEFAULT_SETTINGS.backendFailOpenToDirect
    ),
    openaiApiKey: asString(merged.openaiApiKey, DEFAULT_SETTINGS.openaiApiKey),
    groqApiKey: asString(merged.groqApiKey, DEFAULT_SETTINGS.groqApiKey),
    deepgramApiKey: asString(merged.deepgramApiKey, DEFAULT_SETTINGS.deepgramApiKey)
  };
  if (settings.recordingFolderPath === "") {
    settings.recordingFolderPath = DEFAULT_SETTINGS.recordingFolderPath;
    warnings.push("recordingFolderPath reset to default");
  }
  if (settings.iphoneInboxFolderPath === "") {
    settings.iphoneInboxFolderPath = DEFAULT_SETTINGS.iphoneInboxFolderPath;
    warnings.push("iphoneInboxFolderPath reset to default");
  }
  if (settings.transcriptFolderPath === "") {
    settings.transcriptFolderPath = DEFAULT_SETTINGS.transcriptFolderPath;
    warnings.push("transcriptFolderPath reset to default");
  }
  return {
    settings,
    migrated,
    sourceVersion,
    warnings,
    backupSource: migrated ? data : void 0
  };
}
function getSourceVersion(raw) {
  const version = raw.settingsVersion;
  if (typeof version === "number" && Number.isFinite(version) && version >= 1) {
    return Math.floor(version);
  }
  return 1;
}
function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function asString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}
function asPath(value, fallback) {
  if (typeof value !== "string")
    return fallback;
  return value.trim().replace(/^\/+|\/+$/g, "");
}
function asBoundedNumber(value, fallback, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return fallback;
  return Math.min(max, Math.max(min, value));
}
function asEnum(value, enumObj, fallback) {
  const allowed = Object.values(enumObj);
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
