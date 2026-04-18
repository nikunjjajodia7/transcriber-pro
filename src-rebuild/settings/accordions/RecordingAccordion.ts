import { Setting } from 'obsidian';
import { AIModels } from '../../adapters/AIAdapter';
import { BaseAccordion } from './BaseAccordion';

export class RecordingAccordion extends BaseAccordion {
  constructor(containerEl, settings, getAdapter, plugin) {
    super(containerEl, "\u{1F399} Recording", "Configure recording preferences and select a transcription model.");
    this.settings = settings;
    this.getAdapter = getAdapter;
    this.plugin = plugin;
    this.modelDropdown = null;
    this.modelSetting = null;
  }
  render() {
    this.createRecordingPathSetting();
    this.createIphoneInboxPathSetting();
    this.createTranscriptPathSetting();
    this.createAudioQualitySetting();
    this.createStreamingModeSetting();
    this.createFloatingButtonSetting();
    this.createMicButtonColorSetting();
    this.createTranscriptionFormatSetting();
    this.createTranscriptionModelSetting();
    this.createSpeakerDiarizationSetting();
    this.createDeepgramLanguageSettings();
    this.createBatchChunkingSettings();
  }
  createTranscriptPathSetting() {
    new Setting(this.contentEl).setName("Transcript path").setDesc("Specify the folder path to save transcripts relative to the vault root").addText((text) => {
      text.setPlaceholder("Transcripts").setValue(this.settings.transcriptFolderPath).onChange(async (value) => {
        this.settings.transcriptFolderPath = value.trim() || "Transcripts";
        await this.plugin.saveSettings();
      });
    });
  }
  createRecordingPathSetting() {
    new Setting(this.contentEl).setName("Recording path").setDesc("Specify the folder path to save recordings relative to the vault root").addText((text) => {
      text.setPlaceholder("Recordings").setValue(this.settings.recordingFolderPath).onChange(async (value) => {
        this.settings.recordingFolderPath = value.trim() || "Recordings";
        await this.plugin.saveSettings();
      });
    });
  }
  createAudioQualitySetting() {
    new Setting(this.contentEl).setName("Audio quality").setDesc("Set the recording quality (affects file size and clarity)").addDropdown((dropdown) => {
      dropdown.addOption("low" /* Low */, "Voice optimized (smaller files)").addOption("medium" /* Medium */, "CD quality (balanced)").addOption("high" /* High */, "Enhanced quality (larger files)").setValue(this.settings.audioQuality).onChange(async (value) => {
        this.settings.audioQuality = value;
        await this.plugin.saveSettings();
      });
    });
  }
  createFloatingButtonSetting() {
    const floatingBtnSetting = new Setting(this.contentEl).setName("Show floating button").setDesc("Show a floating microphone button for quick recording").addToggle((toggle) => {
      toggle.setValue(this.settings.showFloatingButton).onChange(async (value) => {
        this.settings.showFloatingButton = value;
        await this.plugin.saveSettings();
        this.plugin.events.trigger("floating-button-setting-changed", value);
        this.refresh();
      });
    });
  }
  async refresh() {
    try {
      if (!this.modelDropdown) {
        return;
      }
      await this.setupModelDropdown(this.modelDropdown);
    } catch (error) {
      throw error;
    }
  }
  createMicButtonColorSetting() {
    new Setting(this.contentEl).setName("Mic button color").setDesc("Choose the color for the microphone buttons").addColorPicker((color) => {
      color.setValue(this.settings.micButtonColor).onChange(async (value) => {
        this.settings.micButtonColor = value;
        this.plugin.updateAllButtonColors();
        await this.plugin.saveSettings();
      });
    });
  }
  createTranscriptionFormatSetting() {
    new Setting(this.contentEl).setName("Transcription format").setDesc("Customize the transcription callout format. Use {audioPath} for audio file path and {transcription} for the transcribed text").addTextArea((text) => {
      text.setPlaceholder(">[!info]- Transcription\n>![[{audioPath}]]\n>{transcription}").setValue(this.settings.transcriptionCalloutFormat).onChange(async (value) => {
        this.settings.transcriptionCalloutFormat = value;
        await this.plugin.saveSettings();
      });
      text.inputEl.rows = 4;
      text.inputEl.style.width = "100%";
    });
  }
  createTranscriptionModelSetting() {
    if (this.modelSetting) {
      this.modelSetting.settingEl.remove();
    }
    this.modelSetting = new Setting(this.contentEl).setName("Transcription model").setDesc("Select the AI model for transcription").addDropdown((dropdown) => {
      this.modelDropdown = dropdown;
      this.setupModelDropdown(dropdown);
      dropdown.onChange(async (value) => {
        this.settings.transcriptionModel = value;
        const provider = this.getProviderFromModel(value);
        if (provider) {
          this.settings.transcriptionProvider = provider;
          await this.plugin.saveSettings();
        }
      });
    });
  }
  async setupModelDropdown(dropdown) {
    dropdown.selectEl.empty();
    let hasValidProvider = false;
    for (const provider of ["openai" /* OpenAI */, "groq" /* Groq */, "deepgram" /* Deepgram */]) {
      const apiKey = this.settings[`${provider}ApiKey`];
      if (apiKey) {
        const adapter = this.getAdapter(provider);
        if (adapter) {
          const models = adapter.getAvailableModels("transcription");
          if (models.length > 0) {
            hasValidProvider = true;
            const group = document.createElement("optgroup");
            group.label = `${provider.toUpperCase()} Models`;
            models.forEach((model) => {
              const option = document.createElement("option");
              option.value = model.id;
              option.text = `${model.name}`;
              group.appendChild(option);
            });
            dropdown.selectEl.appendChild(group);
          }
        }
      }
    }
    if (!hasValidProvider) {
      dropdown.addOption("none", "No API keys configured");
      dropdown.setDisabled(true);
      this.settings.transcriptionModel = "";
    } else {
      dropdown.setDisabled(false);
      if (!this.settings.transcriptionModel || !this.getProviderFromModel(this.settings.transcriptionModel)) {
        const firstOption = dropdown.selectEl.querySelector('option:not([value="none"])');
        if (firstOption) {
          const modelId = firstOption.value;
          const provider = this.getProviderFromModel(modelId);
          if (provider) {
            this.settings.transcriptionProvider = provider;
            this.settings.transcriptionModel = modelId;
            dropdown.setValue(modelId);
            await this.plugin.saveSettings();
          }
        }
      } else {
        dropdown.setValue(this.settings.transcriptionModel);
      }
    }
    await this.plugin.saveSettings();
  }
  createSpeakerDiarizationSetting() {
    new Setting(this.contentEl).setName("Enable speaker diarization").setDesc("For Deepgram transcription, label lines by speaker (Speaker 1, Speaker 2, etc.)").addToggle((toggle) => {
      toggle.setValue(this.settings.enableSpeakerDiarization).onChange(async (value) => {
        this.settings.enableSpeakerDiarization = value;
        await this.plugin.saveSettings();
      });
    });
  }
  createIphoneInboxPathSetting() {
    new Setting(this.contentEl).setName("iPhone inbox path").setDesc("Folder used for iPhone Voice Memos shared via Files. Latest file can be transcribed with a command.").addText((text) => {
      text.setPlaceholder("Recordings/Inbox").setValue(this.settings.iphoneInboxFolderPath).onChange(async (value) => {
        this.settings.iphoneInboxFolderPath = value.trim() || "Recordings/Inbox";
        await this.plugin.saveSettings();
      });
    });
  }
  createStreamingModeSetting() {
    new Setting(this.contentEl).setName("Enable streaming mode").setDesc("Process recording in chunks during capture for better long-session reliability").addToggle((toggle) => {
      toggle.setValue(this.settings.streamingMode).onChange(async (value) => {
        this.settings.streamingMode = value;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Use expandable floating recorder").setDesc("Expand the floating mic into a non-blocking recorder panel instead of opening a modal").addToggle((toggle) => {
      toggle.setValue(this.settings.useExpandableFloatingRecorder).onChange(async (value) => {
        this.settings.useExpandableFloatingRecorder = value;
        await this.plugin.saveSettings();
      });
    });
  }
  createDeepgramLanguageSettings() {
    new Setting(this.contentEl).setName("Deepgram language auto-detect").setDesc("Enable auto detection for mixed Hindi-English audio").addToggle((toggle) => {
      toggle.setValue(this.settings.deepgramDetectLanguage).onChange(async (value) => {
        this.settings.deepgramDetectLanguage = value;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Deepgram language hints").setDesc("Comma-separated language hints, e.g. en,hi").addText((text) => {
      text.setPlaceholder("en,hi").setValue(this.settings.deepgramLanguageHints).onChange(async (value) => {
        this.settings.deepgramLanguageHints = value.trim() || "en,hi";
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Force Roman script output").setDesc("Convert Hindi Devanagari transcript text to roman letters").addToggle((toggle) => {
      toggle.setValue(this.settings.forceRomanizedOutput).onChange(async (value) => {
        this.settings.forceRomanizedOutput = value;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Live diarization profile").setDesc("Tune Deepgram speaker-change stability vs latency in live mode").addDropdown((dropdown) => {
      dropdown.addOption("accuracy_first", "Accuracy first (recommended)").addOption("balanced", "Balanced").addOption("low_latency", "Low latency").setValue(this.settings.deepgramLiveDiarizationProfile).onChange(async (value) => {
        if (value !== "accuracy_first" && value !== "balanced" && value !== "low_latency") {
          return;
        }
        this.settings.deepgramLiveDiarizationProfile = value;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Show live chunks in note").setDesc("Display chunk-by-chunk live transcript in a temporary in-progress block").addToggle((toggle) => {
      toggle.setValue(this.settings.showLiveChunkPreviewInNote).onChange(async (value) => {
        this.settings.showLiveChunkPreviewInNote = value;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Save live recording audio").setDesc("When enabled, live transcription also saves the full recording audio file locally").addToggle((toggle) => {
      toggle.setValue(this.settings.saveLiveRecordingAudio).onChange(async (value) => {
        this.settings.saveLiveRecordingAudio = value;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Allow partial live finalize").setDesc("If some chunks fail, keep partial live transcript with a warning instead of hard fail").addToggle((toggle) => {
      toggle.setValue(this.settings.allowPartialOnStreamFinalizeFailure).onChange(async (value) => {
        this.settings.allowPartialOnStreamFinalizeFailure = value;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Enable stream transport fallback").setDesc("If repeated chunk 400 errors occur, auto-fallback to safer WAV chunk transport").addToggle((toggle) => {
      toggle.setValue(this.settings.streamTransportFallbackEnabled).onChange(async (value) => {
        this.settings.streamTransportFallbackEnabled = value;
        await this.plugin.saveSettings();
      });
    });
  }
  createBatchChunkingSettings() {
    new Setting(this.contentEl).setName("Chunk large uploaded files").setDesc("Automatically split large uploaded audio files into queue-backed chunks").addToggle((toggle) => {
      toggle.setValue(this.settings.enableBatchChunkingForUploads).onChange(async (value) => {
        this.settings.enableBatchChunkingForUploads = value;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Chunking threshold (MB)").setDesc("Uploaded files above this size use chunked batch transcription").addText((text) => {
      text.setPlaceholder("25").setValue(String(this.settings.batchChunkThresholdMB)).onChange(async (value) => {
        const parsed = Number(value);
        this.settings.batchChunkThresholdMB = Number.isFinite(parsed) ? Math.min(512, Math.max(5, Math.round(parsed))) : 25;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Chunk duration (seconds)").setDesc("Target duration for each uploaded-file chunk").addText((text) => {
      text.setPlaceholder("360").setValue(String(this.settings.batchChunkDurationSec)).onChange(async (value) => {
        const parsed = Number(value);
        this.settings.batchChunkDurationSec = Number.isFinite(parsed) ? Math.min(1800, Math.max(30, Math.round(parsed))) : 360;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Chunk overlap (seconds)").setDesc("Small overlap improves continuity at chunk boundaries").addText((text) => {
      text.setPlaceholder("2").setValue(String(this.settings.batchChunkOverlapSec)).onChange(async (value) => {
        const parsed = Number(value);
        this.settings.batchChunkOverlapSec = Number.isFinite(parsed) ? Math.min(30, Math.max(0, Math.round(parsed))) : 2;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Allow single-request override").setDesc("Show advanced troubleshooting option to force non-chunked upload mode").addToggle((toggle) => {
      toggle.setValue(this.settings.allowSingleRequestOverride).onChange(async (value) => {
        this.settings.allowSingleRequestOverride = value;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Backend base URL").setDesc("Backend API root used for long-upload orchestration, e.g. https://api.example.com").addText((text) => {
      text.setPlaceholder("https://api.example.com").setValue(this.settings.backendBaseUrl).onChange(async (value) => {
        this.settings.backendBaseUrl = value.trim();
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Backend API key (optional)").setDesc("Bearer token for backend orchestration endpoints").addText((text) => {
      text.setPlaceholder("Optional bearer token").setValue(this.settings.backendApiKey).onChange(async (value) => {
        this.settings.backendApiKey = value.trim();
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "password";
    });
    new Setting(this.contentEl).setName("Backend poll interval (ms)").setDesc("How often NeuroVox polls backend job status").addText((text) => {
      text.setPlaceholder("3000").setValue(String(this.settings.backendPollIntervalMs)).onChange(async (value) => {
        const parsed = Number(value);
        this.settings.backendPollIntervalMs = Number.isFinite(parsed) ? Math.min(3e4, Math.max(1e3, Math.round(parsed))) : 3e3;
        await this.plugin.saveSettings();
      });
    });
    new Setting(this.contentEl).setName("Backend job timeout (seconds)").setDesc("Maximum wait time for backend processing before timeout").addText((text) => {
      text.setPlaceholder("1800").setValue(String(this.settings.backendJobTimeoutSec)).onChange(async (value) => {
        const parsed = Number(value);
        this.settings.backendJobTimeoutSec = Number.isFinite(parsed) ? Math.min(14400, Math.max(60, Math.round(parsed))) : 1800;
        await this.plugin.saveSettings();
      });
    });
  }
  getProviderFromModel(modelId) {
    for (const [provider, models] of Object.entries(AIModels)) {
      if (models.some((model) => model.id === modelId)) {
        return provider;
      }
    }
    return null;
  }
}
