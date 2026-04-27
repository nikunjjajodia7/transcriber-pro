import { Events, MarkdownView, Notice, Platform, Plugin, TFile, normalizePath } from 'obsidian';
import { CURRENT_SETTINGS_VERSION, DEFAULT_SETTINGS } from './settings/Settings';
import { DeepgramAdapter } from './adapters/DeepgramAdapter';
import { DocumentInserter } from './utils/document/DocumentInserter';
import { FloatingButton } from './ui/FloatingButton';
import { GroqAdapter } from './adapters/GroqAdapter';
import { LocalQueueBackend } from './utils/queue/LocalQueueBackend';
import { NeuroVoxSettingTab } from './settings/SettingTab';
import { OpenAIAdapter } from './adapters/OpenAIAdapter';
import { RecordingProcessor } from './utils/RecordingProcessor';
import { RecoveryJobsModal } from './modals/RecoveryJobsModal';
import { RibbonRecorderController } from './ui/RibbonRecorderController';
import { RuntimeLogger } from './utils/telemetry/RuntimeLogger';
import { TimerModal } from './modals/TimerModal';
import { VideoProcessor } from './utils/VideoProcessor';
import { applySpeakerMappingToEntry, buildEntrySpeakerMappingSection, extractSpeakerLabels, hasEntrySpeakerMappingSection, hasSpeakerMappingSection } from './utils/document/SpeakerMapping';
import { findEntryRegionAtPosition, findEntryRegions } from './utils/document/TranscriptionEntry';
import { migrateAndNormalizeSettings } from './settings/migrations';

class NeuroVoxPlugin extends Plugin {
  buttonMap: any;
  activeLeaf: any;
  settingTab: any;
  events: any;
  processingStatusEl: any;
  processingInterval: any;
  statusReconcileInterval: any;
  processingStartedAt: any;
  processingBaseMessage: any;
  startupValidationInFlight: any;
  speakerAutoApplyDebounceTimers: any;
  speakerAutoApplyInFlight: any;
  modalInstance: any;
  recordingProcessor: any;
  ribbonController: RibbonRecorderController | null = null;
  settings: any;
  aiAdapters: any;
  static STARTUP_VALIDATION_TIMEOUT_MS = 4e3;
  static SPEAKER_AUTO_APPLY_DEBOUNCE_MS = 600;

  constructor(...args: any[]) {
    // @ts-expect-error obsidian Plugin ctor signature wrapped via rest spread
    super(...args);
    this.buttonMap = /* @__PURE__ */ new Map();
    this.activeLeaf = null;
    this.settingTab = null;
    // Custom events emitter
    this.events = new Events();
    this.processingStatusEl = null;
    this.processingInterval = null;
    this.statusReconcileInterval = null;
    this.processingStartedAt = null;
    this.processingBaseMessage = "Idle";
    this.startupValidationInFlight = false;
    this.speakerAutoApplyDebounceTimers = /* @__PURE__ */ new Map();
    this.speakerAutoApplyInFlight = /* @__PURE__ */ new Set();
    this.modalInstance = null;
  }
  async onload() {
    const startupStartedAt = performance.now();
    try {
      await this.loadSettings();
      this.initializeAIAdapters();
      this.registerSettingsTab();
      this.registerCommands();
      this.registerEvents();
      this.registerTranscriptTimestampSeekProcessor();
      this.recordingProcessor = RecordingProcessor.getInstance(this);
      this.initializeUI();
      this.initializeProcessingStatus();
      this.initializeRibbonController();
      await this.reconcileProcessingStatusFromJobs();
      this.startProcessingStatusReconciliation();
      this.registerFloatingButtonEvents();
      this.events.trigger("floating-button-setting-changed", this.settings.showFloatingButton);
      this.maybeShowRibbonFirstRunNotice();
      const elapsed = Math.round(performance.now() - startupStartedAt);
      console.debug(`[NeuroVox][Startup] critical startup complete in ${elapsed}ms`);
      this.startDeferredStartupTasks();
    } catch (error) {
      new Notice("Failed to initialize NeuroVox plugin");
    }
  }
  initializeRibbonController() {
    if (!Platform.isMobile) return;
    if (this.settings.recorderMode !== 'ribbon') return;
    if (this.ribbonController) return;
    this.ribbonController = new RibbonRecorderController(this);
    this.ribbonController.register();
  }
  // One-time upgrade Notice for mobile users flipped to `recorderMode: 'ribbon'`
  // by the v5→v6 migration. Lets them revert to the floating mic in one tap.
  maybeShowRibbonFirstRunNotice() {
    if (!Platform.isMobile) return;
    if (this.settings.recorderMode !== 'ribbon') return;
    if (this.settings.firstRunRibbonNoticeShown) return;
    const fragment = document.createDocumentFragment();
    const intro = document.createElement('div');
    intro.setText(
      'NeuroVox mobile now uses ribbon icons + a tap-to-stop indicator. The floating mic was retired to fix iOS keyboard bugs.'
    );
    intro.style.marginBottom = '8px';
    fragment.appendChild(intro);
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.flexWrap = 'wrap';
    const gotIt = document.createElement('button');
    gotIt.textContent = 'Got it';
    gotIt.classList.add('mod-cta');
    const restore = document.createElement('button');
    restore.textContent = 'Restore floating mic';
    actions.appendChild(gotIt);
    actions.appendChild(restore);
    fragment.appendChild(actions);
    const notice = new Notice(fragment, 0);
    let resolved = false;
    const finish = async (restoreFloating: boolean) => {
      if (resolved) return;
      resolved = true;
      this.settings.firstRunRibbonNoticeShown = true;
      if (restoreFloating) {
        this.settings.recorderMode = 'floating';
      }
      try {
        await this.saveSettings({ refreshUi: false, triggerFloatingRefresh: restoreFloating });
      } catch (e) {
        // best-effort persistence — Notice still hides below
      }
      notice.hide();
      if (restoreFloating) {
        new Notice('Floating mic restored. Reload Obsidian to take effect.', 8000);
      }
    };
    gotIt.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      void finish(false);
    });
    restore.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      void finish(true);
    });
  }
  /**
   * Register event listeners for floating button setting changes
   */
  registerFloatingButtonEvents() {
    this.events.on("floating-button-setting-changed", (isEnabled: any) => {
      this.cleanupUI();
      if (isEnabled) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.file) {
          this.createButtonForFile(activeView.file);
        }
      }
    });
  }
  /**
   * Load plugin settings with proper fallback to defaults and validation
   */
  async loadSettings() {
    try {
      const data = await this.loadData();
      const migration = migrateAndNormalizeSettings(data);
      this.settings = migration.settings;
      if (migration.migrated) {
        await this.persistSettingsBackup(migration.backupSource);
        await this.saveData(this.settings);
        new Notice(
          `NeuroVox settings migrated to v${CURRENT_SETTINGS_VERSION} from v${migration.sourceVersion}.`
        );
      }
      if (migration.warnings.length > 0) {
        new Notice("NeuroVox normalized invalid settings values.");
      }
    } catch (error) {
      this.settings = { ...DEFAULT_SETTINGS };
      new Notice("Failed to load NeuroVox settings. Using defaults.");
    }
  }
  /**
   * Save settings to plugin data storage
   */
  async saveSettings(options?: any) {
    var _a, _b;
    try {
      this.settings.settingsVersion = CURRENT_SETTINGS_VERSION;
      await this.saveData(this.settings);
      const refreshUi = (_a = options == null ? void 0 : options.refreshUi) != null ? _a : true;
      const triggerFloatingRefresh = (_b = options == null ? void 0 : options.triggerFloatingRefresh) != null ? _b : true;
      if (refreshUi) {
        this.initializeUI();
      }
      if (triggerFloatingRefresh) {
        this.events.trigger("floating-button-setting-changed", this.settings.showFloatingButton);
      }
    } catch (error) {
      new Notice("Failed to save NeuroVox settings");
    }
  }
  async validateApiKeys(showInvalidNotices = true) {
    try {
      const openaiAdapter = this.aiAdapters.get("openai" /* OpenAI */);
      const groqAdapter = this.aiAdapters.get("groq" /* Groq */);
      const deepgramAdapter = this.aiAdapters.get("deepgram" /* Deepgram */);
      if (openaiAdapter) {
        openaiAdapter.setApiKey(this.settings.openaiApiKey);
        await this.validateAdapterWithTimeout(openaiAdapter);
      }
      if (groqAdapter) {
        groqAdapter.setApiKey(this.settings.groqApiKey);
        await this.validateAdapterWithTimeout(groqAdapter);
      }
      if (deepgramAdapter) {
        deepgramAdapter.setApiKey(this.settings.deepgramApiKey);
        await this.validateAdapterWithTimeout(deepgramAdapter);
      }
      if (showInvalidNotices && openaiAdapter && !openaiAdapter.isReady() && this.settings.openaiApiKey) {
        new Notice("\u274C OpenAI API key validation failed");
      }
      if (showInvalidNotices && groqAdapter && !groqAdapter.isReady() && this.settings.groqApiKey) {
        new Notice("\u274C Groq API key validation failed");
      }
      if (showInvalidNotices && deepgramAdapter && !deepgramAdapter.isReady() && this.settings.deepgramApiKey) {
        new Notice("\u274C Deepgram API key validation failed");
      }
    } catch (error) {
    }
  }
  initializeAIAdapters() {
    try {
      const adapters: Array<[string, any]> = [
        ["openai" /* OpenAI */, new OpenAIAdapter(this.settings)],
        ["groq" /* Groq */, new GroqAdapter(this.settings)],
        ["deepgram" /* Deepgram */, new DeepgramAdapter(this.settings)]
      ];
      this.aiAdapters = new Map(adapters);
    } catch (error) {
      throw new Error("Failed to initialize AI adapters");
    }
  }
  registerSettingsTab() {
    this.addSettingTab(new NeuroVoxSettingTab(this.app, this));
  }
  registerCommands() {
    this.addCommand({
      id: "start-recording",
      name: "Start recording",
      checkCallback: (checking) => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!(activeView && activeView.file))
          return false;
        if (checking)
          return true;
        this.handleRecordingStart();
        return true;
      }
    });
    this.addCommand({
      id: "transcribe-audio",
      name: "Transcribe audio file",
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || !this.isValidAudioFile(activeFile)) {
          new Notice("\u274C Active file is not a valid audio file");
          return;
        }
        new Notice(`\u{1F3B5} Transcribing: ${activeFile.path}`);
        await this.processExistingAudioFile(activeFile);
      }
    });
    this.addCommand({
      id: "transcribe-video",
      name: "Transcribe video file",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        const isValidVideo = this.isValidVideoFile(activeFile);
        if (!activeFile || !isValidVideo)
          return false;
        if (checking)
          return true;
        void this.processVideoFile(activeFile);
        return true;
      }
    });
    this.addCommand({
      id: "transcribe-latest-iphone-inbox-recording",
      name: "Transcribe latest iPhone inbox recording",
      callback: async () => {
        await this.transcribeLatestIphoneInboxRecording();
      }
    });
    this.addCommand({
      id: "inspect-local-queue",
      name: "Inspect queue",
      callback: async () => {
        try {
          const queue = new LocalQueueBackend(this);
          const jobs = await queue.getSnapshot();
          if (jobs.length === 0) {
            new Notice("NeuroVox queue is empty.");
            return;
          }
          const counts = jobs.reduce((acc, j) => {
            acc[j.status] = (acc[j.status] || 0) + 1;
            return acc;
          }, {});
          const summary = [
            `total=${jobs.length}`,
            `queued=${counts.queued || 0}`,
            `claimed=${counts.claimed || 0}`,
            `running=${counts.running || 0}`,
            `retry=${counts.retry_scheduled || 0}`,
            `failed=${counts.failed || 0}`,
            `completed=${counts.completed || 0}`,
            `canceled=${counts.canceled || 0}`
          ].join(" | ");
          new Notice(`NeuroVox queue: ${summary}`, 12e3);
          const top = jobs.slice(0, 3).map((j) => `${j.id} ${j.status} attempts=${j.attemptCount}`);
          if (top.length > 0) {
            new Notice(`Recent jobs:
${top.join("\n")}`, 12e3);
          }
        } catch (error) {
          new Notice("Failed to inspect NeuroVox queue.");
        }
      }
    });
    this.addCommand({
      id: "cancel-all-incomplete-jobs",
      name: "Cancel all incomplete jobs",
      callback: async () => {
        try {
          const pending = await this.recordingProcessor.getIncompleteJobs();
          if (pending.length === 0) {
            new Notice("NeuroVox has no incomplete jobs to cancel.");
            return;
          }
          await Promise.all(pending.map((job: any) => this.recordingProcessor.cancelJob(job.jobId)));
          await this.reconcileProcessingStatusFromJobs();
          new Notice(`NeuroVox canceled ${pending.length} incomplete job(s).`);
        } catch (error) {
          new Notice("Failed to cancel incomplete NeuroVox jobs.");
        }
      }
    });
    this.addCommand({
      id: "review-recovery-jobs",
      name: "Review recovery jobs",
      callback: async () => {
        try {
          await this.openRecoveryJobsModal();
        } catch (e) {
          new Notice("NeuroVox recovery review failed.");
        }
      }
    });
    this.addCommand({
      id: "diagnose-deepgram-diarization-from-active-note",
      name: "Diagnose Deepgram diarization (active note source)",
      callback: async () => {
        try {
          if (this.settings.transcriptionProvider !== "deepgram" /* Deepgram */) {
            new Notice("Set transcription provider to Deepgram before running diagnosis.");
            return;
          }
          const deepgram = this.aiAdapters.get("deepgram" /* Deepgram */);
          if (!(deepgram instanceof DeepgramAdapter)) {
            new Notice("Deepgram adapter is not available.");
            return;
          }
          if (!deepgram.getApiKey()) {
            new Notice("Deepgram API key is not configured.");
            return;
          }
          const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
          const activeFile = activeView && activeView.file;
          if (!activeFile) {
            new Notice("Open a transcript note with source metadata first.");
            return;
          }
          const content = await this.app.vault.read(activeFile);
          const sourcePath = this.resolveSourcePathFromNote(content);
          if (!sourcePath) {
            new Notice("No source path found in this note.");
            return;
          }
          const adapter = this.app.vault.adapter;
          const normalizedSource = normalizePath(sourcePath);
          if (!await adapter.exists(normalizedSource)) {
            new Notice(`Source audio file not found: ${normalizedSource}`);
            return;
          }
          const binary = await adapter.readBinary(normalizedSource);
          const mimeType = this.inferMimeTypeFromPath(normalizedSource);
          const diagnosis = await deepgram.diagnoseAudio(
            binary,
            this.settings.transcriptionModel,
            { mimeType }
          );
          const reportPath = await this.writeDeepgramDiagnosticReport(
            diagnosis,
            normalizedSource
          );
          new Notice(`Deepgram diagnosis saved: ${reportPath}`, 1e4);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Deepgram diagnosis failed: ${message}`, 1e4);
        }
      }
    });
    this.addCommand({
      id: "apply-speaker-names-from-mapping",
      name: "Apply speaker names from mapping",
      callback: async () => {
        await this.applySpeakerNamesFromMappingInActiveNote();
      }
    });
    this.addCommand({
      id: "generate-speaker-mapping-for-active-note",
      name: "Generate speaker mapping for active note",
      callback: async () => {
        await this.generateSpeakerMappingForActiveNote();
      }
    });
    this.addCommand({
      id: "rename-current-transcription-entry",
      name: "Rename current transcription entry",
      callback: async () => {
        await this.renameCurrentTranscriptionEntry();
      }
    });
  }
  isValidAudioFile(file: any) {
    if (!file)
      return false;
    const validExtensions = ["mp3", "wav", "webm", "m4a"];
    return validExtensions.includes(file.extension.toLowerCase());
  }
  isSupportedInboxAudioFile(file: any) {
    const validExtensions = ["mp3", "wav", "webm", "m4a", "ogg", "mp4", "aac"];
    return validExtensions.includes(file.extension.toLowerCase());
  }
  isFileWithinFolder(filePath: any, folderPath: any) {
    const normalizedFilePath = normalizePath(filePath);
    const normalizedFolder = normalizePath(folderPath).replace(/\/+$/, "");
    if (!normalizedFolder)
      return false;
    return normalizedFilePath.startsWith(`${normalizedFolder}/`);
  }
  async transcribeLatestIphoneInboxRecording() {
    try {
      const inboxFolder = normalizePath(
        (this.settings.iphoneInboxFolderPath || "Recordings/Inbox").trim()
      );
      const adapter = this.app.vault.adapter;
      if (!await adapter.exists(inboxFolder)) {
        new Notice(`iPhone inbox folder not found: ${inboxFolder}`);
        return;
      }
      const candidates = this.app.vault.getFiles().filter(
        (file) => this.isSupportedInboxAudioFile(file) && this.isFileWithinFolder(file.path, inboxFolder)
      ).sort((a, b) => b.stat.mtime - a.stat.mtime);
      if (candidates.length === 0) {
        new Notice(`No audio files found in iPhone inbox: ${inboxFolder}`);
        return;
      }
      const latestFile = candidates[0];
      new Notice(`\u{1F3B5} Transcribing latest inbox file: ${latestFile.name}`);
      await this.processExistingAudioFile(latestFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to transcribe latest iPhone inbox recording: ${message}`);
    }
  }
  isValidVideoFile(file: any) {
    if (!file)
      return false;
    const validExtensions = ["mp4", "webm", "mov"];
    return validExtensions.includes(file.extension.toLowerCase());
  }
  getAudioMimeType(extension: any) {
    const mimeTypes = {
      "mp3": "audio/mpeg",
      "wav": "audio/wav",
      "webm": "audio/webm",
      "m4a": "audio/mp4"
    } as Record<string, string>;
    return mimeTypes[extension.toLowerCase()] || "audio/wav";
  }
  getVideoMimeType(extension: any) {
    const mimeTypes: Record<string, string> = {
      "mp4": "video/mp4",
      "webm": "video/webm",
      "mov": "video/quicktime"
    };
    return mimeTypes[extension.toLowerCase()] || "video/mp4";
  }
  async processExistingAudioFile(file: any) {
    try {
      const adapter = this.aiAdapters.get(this.settings.transcriptionProvider);
      if (!adapter) {
        throw new Error(`Transcription provider ${this.settings.transcriptionProvider} not found`);
      }
      if (!adapter.getApiKey()) {
        throw new Error(`API key not set for ${this.settings.transcriptionProvider}`);
      }
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
      const sanitizedName = file.basename.replace(/[\\/:*?"<>|]/g, "");
      const transcriptsFolder = this.settings.transcriptFolderPath || "Transcripts";
      const baseFileName = `${transcriptsFolder}/${timestamp}-${sanitizedName}.md`;
      let newFileName = baseFileName;
      let count = 1;
      const normalizedPath = normalizePath(transcriptsFolder);
      if (!await this.app.vault.adapter.exists(normalizedPath)) {
        await this.app.vault.createFolder(normalizedPath);
      }
      while (await this.app.vault.adapter.exists(newFileName)) {
        newFileName = `${transcriptsFolder}/${timestamp}-${sanitizedName}-${count}.md`;
        count++;
      }
      const initialContent = [
        "# \u{1F3B5} Audio Transcription",
        "",
        ""
      ].join("\n");
      const newFile = await this.app.vault.create(newFileName, initialContent);
      await this.app.workspace.getLeaf().openFile(newFile);
      const audioBuffer = await this.app.vault.readBinary(file);
      const blob = new Blob([audioBuffer], {
        type: this.getAudioMimeType(file.extension)
      });
      new Notice("\u{1F399}\uFE0F Processing audio file...");
      await this.recordingProcessor.processRecording(
        blob,
        newFile,
        { line: initialContent.split("\n").length, ch: 0 },
        file.path
      );
      new Notice("\u2728 Transcription completed successfully!");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      new Notice(`\u274C ${errorMessage}`);
      return;
    }
  }
  async processVideoFile(file: any) {
    try {
      const videoProcessor = await VideoProcessor.getInstance(this);
      await videoProcessor.processVideo(file);
    } catch (error) {
      new Notice("\u274C Failed to process video file");
      throw error;
    }
  }
  registerEvents() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", this.handleActiveLeafChange.bind(this))
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", this.handleLayoutChange.bind(this))
    );
    this.registerEvent(
      this.app.vault.on("delete", this.handleFileDelete.bind(this))
    );
    this.registerEvent(
      this.app.vault.on("modify", this.handleNoteModifyForSpeakerAutoApply.bind(this))
    );
  }
  registerTranscriptTimestampSeekProcessor() {
    this.registerMarkdownPostProcessor((el, ctx) => {
      this.convertLegacyTimestampLinks(el);
      this.decorateBracketTimestampTokens(el);
      this.bindLiveCalloutFoldStateCapture(el, ctx == null ? void 0 : ctx.sourcePath);
    });
  }
  bindLiveCalloutFoldStateCapture(root: any, sourcePath: any) {
    const notePath = (sourcePath || "").trim();
    if (!notePath)
      return;
    const liveCallouts: any[] = Array.from(root.querySelectorAll(".callout"));
    if (liveCallouts.length === 0)
      return;
    for (const callout of liveCallouts) {
      if (!this.isLiveTranscriptionCallout(callout))
        continue;
      const titleEl = callout.querySelector(".callout-title");
      if (!(titleEl instanceof HTMLElement))
        continue;
      const boundKey = `${notePath}::live-fold-capture`;
      if (titleEl.dataset.neurovoxLiveFoldCaptureKey === boundKey)
        continue;
      titleEl.dataset.neurovoxLiveFoldCaptureKey = boundKey;
      titleEl.addEventListener("click", () => {
        window.requestAnimationFrame(() => {
          DocumentInserter.setLiveCalloutCollapsedState(
            notePath,
            callout.hasClass("is-collapsed")
          );
        });
      });
    }
  }
  isLiveTranscriptionCallout(callout: any) {
    var _a, _b, _c;
    const titleText = ((_b = (_a = callout.querySelector(".callout-title-inner")) == null ? void 0 : _a.textContent) == null ? void 0 : _b.trim().toLowerCase()) || "";
    const bodyText = ((_c = callout.textContent) == null ? void 0 : _c.toLowerCase()) || "";
    if (titleText.includes("live transcription") && bodyText.includes("type: live-transcription")) {
      return true;
    }
    return false;
  }
  convertLegacyTimestampLinks(root: any) {
    const links = root.querySelectorAll("a.internal-link");
    links.forEach((link: any) => {
      const hhmmss = this.extractLegacyTimestampFromLink(link);
      if (!hhmmss)
        return;
      const tokenEl = this.createTimestampTokenEl(`[${hhmmss}]`, hhmmss);
      link.replaceWith(tokenEl);
    });
  }
  extractLegacyTimestampFromLink(link: any) {
    const candidates = [
      link.getAttribute("data-href") || "",
      link.getAttribute("href") || "",
      link.textContent || ""
    ];
    for (const value of candidates) {
      const normalized = value.trim().replace(/^#/, "");
      const direct = /^t=(\d{2}:\d{2}:\d{2})$/i.exec(normalized);
      if (direct)
        return direct[1];
      const wrapped = /^\[\[t=(\d{2}:\d{2}:\d{2})\]\]$/i.exec(normalized);
      if (wrapped)
        return wrapped[1];
    }
    return null;
  }
  decorateBracketTimestampTokens(root: any) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let current = walker.nextNode();
    while (current) {
      textNodes.push(current);
      current = walker.nextNode();
    }
    const tokenRegex = /\[((?:\d{2}:)?\d{2}:\d{2})\]/g;
    for (const node of textNodes) {
      const parent = node.parentElement;
      if (!parent)
        continue;
      if (parent.closest("pre, code, a"))
        continue;
      const raw = node.nodeValue || "";
      tokenRegex.lastIndex = 0;
      if (!tokenRegex.test(raw))
        continue;
      const fragment = document.createDocumentFragment();
      tokenRegex.lastIndex = 0;
      let lastIndex = 0;
      let match = tokenRegex.exec(raw);
      while (match) {
        const fullMatch = match[0];
        const hhmmss = match[1];
        const start = match.index;
        if (start > lastIndex) {
          fragment.appendChild(document.createTextNode(raw.slice(lastIndex, start)));
        }
        fragment.appendChild(this.createTimestampTokenEl(fullMatch, hhmmss));
        lastIndex = start + fullMatch.length;
        match = tokenRegex.exec(raw);
      }
      if (lastIndex < raw.length) {
        fragment.appendChild(document.createTextNode(raw.slice(lastIndex)));
      }
      parent.replaceChild(fragment, node);
    }
  }
  createTimestampTokenEl(label: any, timestampText: any) {
    const token = document.createElement("span");
    token.className = "neurovox-timestamp-token";
    token.setAttribute("role", "button");
    token.setAttribute("tabindex", "0");
    token.setAttribute("aria-label", `Seek audio to ${timestampText}`);
    token.textContent = label;
    token.style.cursor = "pointer";
    token.style.textDecoration = "underline";
    const handleActivate = () => {
      const seconds = this.parseTimestampToSeconds(timestampText);
      if (seconds === null)
        return;
      this.seekNearestAudioFromToken(token, seconds);
    };
    token.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      handleActivate();
    });
    token.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ")
        return;
      evt.preventDefault();
      evt.stopPropagation();
      handleActivate();
    });
    return token;
  }
  parseTimestampToSeconds(timestampText: any) {
    const parts = timestampText.trim().split(":");
    if (parts.length !== 2 && parts.length !== 3)
      return null;
    const values = parts.map((part: any) => Number(part));
    if (values.some((value: any) => !Number.isFinite(value))) {
      return null;
    }
    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    if (values.length === 3) {
      [hours, minutes, seconds] = values;
    } else {
      [minutes, seconds] = values;
    }
    if (hours < 0 || minutes < 0 || seconds < 0 || minutes > 59 || seconds > 59) {
      return null;
    }
    return Math.max(0, hours * 3600 + minutes * 60 + seconds);
  }
  seekNearestAudioFromToken(tokenEl: any, targetSeconds: any) {
    const audio = this.findNearestAudioElement(tokenEl);
    if (!audio) {
      new Notice("No audio player found in this note.");
      return;
    }
    try {
      audio.currentTime = targetSeconds;
      const playResult = audio.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => {
        });
      }
    } catch (e) {
      new Notice("Could not seek audio for this timestamp.");
    }
  }
  findNearestAudioElement(tokenEl: any) {
    const calloutContainer = tokenEl.closest(".callout");
    if (calloutContainer) {
      const inCallout = calloutContainer.querySelector("audio");
      if (inCallout instanceof HTMLAudioElement) {
        return inCallout;
      }
    }
    const renderedContainer = tokenEl.closest(".markdown-rendered, .markdown-reading-view, .markdown-preview-view");
    if (renderedContainer) {
      const inNote = renderedContainer.querySelector("audio");
      if (inNote instanceof HTMLAudioElement) {
        return inNote;
      }
    }
    const globalAudio = document.querySelector("audio");
    return globalAudio instanceof HTMLAudioElement ? globalAudio : null;
  }
  async handleActiveLeafChange(leaf: any) {
    this.activeLeaf = leaf;
    for (const button of this.buttonMap.values()) {
      var _panel;
      if ((_panel = button.inlineRecorderPanel) && (_panel.state === "recording" || _panel.state === "paused")) {
        try {
          await _panel.stop();
        } catch (e) {
          console.error("[NeuroVox] Failed to stop recording on note switch:", e);
        }
      }
      button.remove();
    }
    this.buttonMap.clear();
    if (this.settings.showFloatingButton && (leaf == null ? void 0 : leaf.view) instanceof MarkdownView && leaf.view.file) {
      this.createButtonForFile(leaf.view.file);
    }
  }
  handleLayoutChange() {
    if (this.settings.showFloatingButton) {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView && activeView.file) {
        const button = this.buttonMap.get(activeView.file.path);
        if (button) {
          button.show();
        } else {
          this.createButtonForFile(activeView.file);
        }
      }
    }
  }
  handleFileDelete(file: any) {
    if (file instanceof TFile) {
      const button = this.buttonMap.get(file.path);
      if (button) {
        button.remove();
        this.buttonMap.delete(file.path);
      }
    }
  }
  initializeUI() {
    this.cleanupUI();
  }
  createButtonForFile(file: any) {
    const existingButton = this.buttonMap.get(file.path);
    if (existingButton) {
      existingButton.remove();
      this.buttonMap.delete(file.path);
    }
    const button = new FloatingButton(
      this,
      this.settings,
      () => this.handleRecordingStart()
    );
    this.buttonMap.set(file.path, button);
  }
  cleanupUI() {
    this.buttonMap.forEach((button: any) => button.remove());
    this.buttonMap.clear();
  }
  handleRecordingStart() {
    var _a;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice("\u274C No active note found to insert transcription.");
      return;
    }
    const activeFile = activeView.file;
    if (!activeFile) {
      new Notice("\u274C No active file found.");
      return;
    }
    const insertionPosition = activeView.editor.getCursor();
    if (this.settings.useRecordingModal) {
      if (this.modalInstance)
        return;
      this.modalInstance = new TimerModal(this, activeFile, insertionPosition);
      this.modalInstance.onStop = async (result: any) => {
        try {
          if (typeof result === "string") {
            await this.recordingProcessor.processStreamingResult(
              result,
              activeFile,
              insertionPosition
            );
          } else {
            const adapter = this.aiAdapters.get(this.settings.transcriptionProvider);
            if (!adapter) {
              throw new Error(`Transcription provider ${this.settings.transcriptionProvider} not found`);
            }
            if (!adapter.getApiKey()) {
              throw new Error(`API key not set for ${this.settings.transcriptionProvider}`);
            }
            await this.recordingProcessor.processRecording(
              result,
              activeFile,
              insertionPosition
            );
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          new Notice(`\u274C Failed to process recording: ${errorMessage}`);
        }
      };
      const originalOnClose = (_a = this.modalInstance.onClose) == null ? void 0 : _a.bind(this.modalInstance);
      this.modalInstance.onClose = async () => {
        if (originalOnClose) {
          await originalOnClose();
        }
        this.modalInstance = null;
        return Promise.resolve();
      };
      this.modalInstance.open();
    }
  }
  updateAllButtonColors() {
    this.buttonMap.forEach((button: any) => {
      button.updateButtonColor();
    });
  }
  initializeProcessingStatus() {
    this.processingStatusEl = this.addStatusBarItem();
    this.processingStatusEl.addClass("neurovox-status");
    this.setProcessingStatus("Idle");
  }
  startProcessingStatusReconciliation() {
    if (this.statusReconcileInterval !== null)
      return;
    this.statusReconcileInterval = window.setInterval(() => {
      void this.reconcileProcessingStatusFromJobs();
    }, 5e3);
  }
  async reconcileProcessingStatusFromJobs() {
    try {
      const jobs = await this.recordingProcessor.getIncompleteJobs();
      const activeCount = jobs.filter((job: any) => job.status === "queued" || job.status === "running").length;
      const failedCount = jobs.filter((job: any) => job.status === "failed").length;
      if (activeCount > 0) {
        if (!this.processingStartedAt) {
          this.showProcessingStatus(`Processing ${activeCount} job(s)`);
        }
        return;
      }
      if (failedCount > 0) {
        if (!this.processingStartedAt) {
          this.setProcessingStatus(`Needs attention (${failedCount} failed)`);
        }
        return;
      }
      this.setProcessingStatus("Idle");
    } catch (e) {
    }
  }
  startDeferredStartupTasks() {
    void this.validateApiKeysInBackground();
    void this.runDeferredMaintenanceAndRecovery();
  }
  async validateApiKeysInBackground() {
    if (this.startupValidationInFlight)
      return;
    this.startupValidationInFlight = true;
    const startedAt = performance.now();
    try {
      await this.validateApiKeys(false);
    } finally {
      const elapsed = Math.round(performance.now() - startedAt);
      console.debug(`[NeuroVox][Startup] deferred API key validation finished in ${elapsed}ms`);
      this.startupValidationInFlight = false;
    }
  }
  async runDeferredMaintenanceAndRecovery() {
    const startedAt = performance.now();
    try {
      await this.recordingProcessor.runStartupMaintenance();
      await RuntimeLogger.prune(this);
      await this.cleanupStaleLivePreviewInVault();
    } catch (e) {
      new Notice("NeuroVox startup maintenance skipped due to storage error.");
    }
    try {
      const pending = await this.recordingProcessor.getIncompleteJobs();
      if (pending.length > 0) {
        new Notice(
          `NeuroVox found ${pending.length} incomplete job(s). Use command: Review recovery jobs.`,
          12e3
        );
      }
      await this.reconcileProcessingStatusFromJobs();
    } catch (e) {
      new Notice("NeuroVox recovery scan failed at startup.");
    } finally {
      const elapsed = Math.round(performance.now() - startedAt);
      console.debug(`[NeuroVox][Startup] deferred maintenance+recovery finished in ${elapsed}ms`);
    }
  }
  async cleanupStaleLivePreviewInVault() {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    if (markdownFiles.length === 0)
      return;
    const inserter = new DocumentInserter(this);
    let cleanedNotes = 0;
    let removedBlocks = 0;
    for (const file of markdownFiles) {
      try {
        const removed = await inserter.removeAllLiveTranscriptionBlocks(file);
        if (removed > 0) {
          cleanedNotes += 1;
          removedBlocks += removed;
        }
      } catch (e) {
      }
    }
    if (removedBlocks > 0) {
      new Notice(
        `NeuroVox cleaned ${removedBlocks} stale live preview block(s) across ${cleanedNotes} note(s).`,
        8e3
      );
    }
  }
  async openRecoveryJobsModal() {
    try {
      const pending = await this.recordingProcessor.getIncompleteJobs();
      if (pending.length === 0) {
        new Notice("NeuroVox has no incomplete jobs.");
        return;
      }
      const ordered = [...pending].sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1);
      const modal = new RecoveryJobsModal(this.app, ordered);
      const action = await modal.chooseAction();
      await this.executeRecoveryAction(action, ordered);
    } catch (error) {
      new Notice("NeuroVox recovery scan failed at startup.");
    }
  }
  async executeRecoveryAction(action: any, ordered: any) {
    if (action.type === "resume_newest") {
      const newest = ordered[0];
      if (!newest)
        return;
      const resumed = await this.recordingProcessor.resumeJob(newest.jobId);
      new Notice(
        resumed ? "NeuroVox resumed the newest incomplete transcript from checkpoint." : "NeuroVox could not resume the newest job automatically."
      );
      return;
    }
    if (action.type === "cancel_all") {
      await Promise.all(ordered.map((job: any) => this.recordingProcessor.cancelJob(job.jobId)));
      await this.reconcileProcessingStatusFromJobs();
      new Notice("NeuroVox canceled all incomplete transcription jobs.");
      return;
    }
    if (action.type === "resume") {
      const resumed = await this.recordingProcessor.resumeJob(action.jobId);
      new Notice(
        resumed ? "NeuroVox resumed the selected incomplete transcript from checkpoint." : "NeuroVox could not resume this job automatically."
      );
      return;
    }
    if (action.type === "cancel") {
      await this.recordingProcessor.cancelJob(action.jobId);
      await this.reconcileProcessingStatusFromJobs();
      new Notice("NeuroVox canceled the selected incomplete transcription job.");
    }
  }
  async validateAdapterWithTimeout(adapter: any) {
    return await Promise.race([
      adapter.validateApiKey().catch(() => false),
      new Promise((resolve) => {
        window.setTimeout(() => resolve(false), NeuroVoxPlugin.STARTUP_VALIDATION_TIMEOUT_MS);
      })
    ]);
  }
  showProcessingStatus(message: any) {
    if (!this.processingStatusEl) {
      this.initializeProcessingStatus();
    }
    if (!this.processingStartedAt) {
      this.processingStartedAt = Date.now();
    }
    this.processingBaseMessage = message;
    this.renderProcessingStatus();
    if (this.processingInterval === null) {
      this.processingInterval = window.setInterval(() => {
        this.renderProcessingStatus();
      }, 1e3);
    }
  }
  async persistSettingsBackup(source: any) {
    if (!source)
      return;
    try {
      const adapter = this.app.vault.adapter;
      const baseDir = ".obsidian/plugins/neurovox/settings-backups";
      if (!await adapter.exists(baseDir)) {
        await adapter.mkdir(baseDir);
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = `${baseDir}/settings-backup-${stamp}.json`;
      await adapter.write(backupPath, JSON.stringify(source, null, 2));
    } catch (error) {
      new Notice("NeuroVox could not write settings backup before migration.");
    }
  }
  setProcessingStatus(message: any) {
    if (!this.processingStatusEl) {
      this.initializeProcessingStatus();
    }
    this.processingBaseMessage = message;
    this.processingStartedAt = null;
    if (this.processingInterval !== null) {
      window.clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.renderProcessingStatus();
  }
  renderProcessingStatus() {
    if (!this.processingStatusEl)
      return;
    if (this.processingStartedAt) {
      const elapsedMs = Date.now() - this.processingStartedAt;
      const totalSec = Math.floor(elapsedMs / 1e3);
      const minutes = Math.floor(totalSec / 60).toString().padStart(2, "0");
      const seconds = (totalSec % 60).toString().padStart(2, "0");
      this.processingStatusEl.setText(`NeuroVox: ${this.processingBaseMessage} (${minutes}:${seconds})`);
      return;
    }
    this.processingStatusEl.setText(`NeuroVox: ${this.processingBaseMessage}`);
  }
  extractSourcePathFromFrontmatter(content: any) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch)
      return null;
    const frontmatter = fmMatch[1];
    const sourceLine = frontmatter.split("\n").find((line: any) => line.trim().toLowerCase().startsWith("source:"));
    if (!sourceLine)
      return null;
    return sourceLine.replace(/^source:\s*/i, "").trim();
  }
  extractSourcePathFromCalloutMetadata(content: any) {
    const sourceMatch = /^\s*(?:>\s*)*Source:\s*(.+)\s*$/im.exec(content);
    if (!sourceMatch || !sourceMatch[1])
      return null;
    return sourceMatch[1].trim();
  }
  resolveSourcePathFromNote(content: any) {
    const fromCallout = this.extractSourcePathFromCalloutMetadata(content);
    if (fromCallout)
      return fromCallout;
    return this.extractSourcePathFromFrontmatter(content);
  }
  inferMimeTypeFromPath(path: any) {
    const lower = path.toLowerCase();
    if (lower.endsWith(".m4a") || lower.endsWith(".mp4"))
      return "audio/mp4";
    if (lower.endsWith(".wav"))
      return "audio/wav";
    if (lower.endsWith(".mp3"))
      return "audio/mpeg";
    if (lower.endsWith(".webm"))
      return "audio/webm";
    if (lower.endsWith(".ogg"))
      return "audio/ogg";
    return "application/octet-stream";
  }
  async applySpeakerNamesFromMappingInActiveNote() {
    var _a;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = activeView && activeView.file;
    if (!(activeFile instanceof TFile) || !activeView || activeFile.extension.toLowerCase() !== "md") {
      new Notice("Open a transcript markdown note first.");
      return;
    }
    try {
      const content = await this.app.vault.read(activeFile);
      const region = findEntryRegionAtPosition(content, activeView.editor.getCursor());
      if (!region || !((_a = region.meta) == null ? void 0 : _a.id)) {
        new Notice("No scoped transcription entry mapping found at cursor.");
        return;
      }
      const result = applySpeakerMappingToEntry(content, (region.meta as any).id, region.start, region.end);
      if (result.mappedSpeakers === 0) {
        new Notice("No speaker names found in the Speaker Mapping section.");
        return;
      }
      if (result.replacedCount === 0) {
        new Notice("No matching speaker labels found in this entry body. Ensure lines use speaker labels (e.g., Speaker 1:).");
        return;
      }
      await this.app.vault.modify(activeFile, result.updatedContent);
      new Notice(`Applied ${result.replacedCount} speaker label replacement(s).`);
    } catch (e) {
      new Notice("Failed to apply speaker names from mapping.");
    }
  }
  handleNoteModifyForSpeakerAutoApply(file: any) {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") {
      return;
    }
    if (this.speakerAutoApplyInFlight.has(file.path)) {
      return;
    }
    const existingTimer = this.speakerAutoApplyDebounceTimers.get(file.path);
    if (existingTimer !== void 0) {
      window.clearTimeout(existingTimer);
    }
    const timer = window.setTimeout(() => {
      this.speakerAutoApplyDebounceTimers.delete(file.path);
      void this.autoApplySpeakerMappingForPath(file.path);
    }, NeuroVoxPlugin.SPEAKER_AUTO_APPLY_DEBOUNCE_MS);
    this.speakerAutoApplyDebounceTimers.set(file.path, timer);
  }
  async autoApplySpeakerMappingForPath(path: any) {
    var _a;
    if (this.speakerAutoApplyInFlight.has(path))
      return;
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (!(abstract instanceof TFile) || abstract.extension.toLowerCase() !== "md")
      return;
    this.speakerAutoApplyInFlight.add(path);
    try {
      const content = await this.app.vault.read(abstract);
      if (!hasSpeakerMappingSection(content))
        return;
      const entries = findEntryRegions(content).filter((entry) => {
        var _a2;
        return !!((_a2 = entry.meta) == null ? void 0 : _a2.id);
      });
      if (entries.length === 0)
        return;
      let updated = content;
      let totalReplaced = 0;
      let offset = 0;
      for (const entry of entries) {
        const id = (_a = entry.meta) == null ? void 0 : _a.id;
        if (!id)
          continue;
        const start = entry.start + offset;
        const end = entry.end + offset;
        const result = applySpeakerMappingToEntry(updated, id, start, end);
        if (result.replacedCount === 0)
          continue;
        totalReplaced += result.replacedCount;
        offset += result.updatedContent.length - updated.length;
        updated = result.updatedContent;
      }
      if (totalReplaced === 0 || updated === content)
        return;
      await this.app.vault.modify(abstract, updated);
    } catch (error) {
      console.warn("[NeuroVox] speaker auto-apply failed", {
        path,
        reason: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.speakerAutoApplyInFlight.delete(path);
    }
  }
  async generateSpeakerMappingForActiveNote() {
    var _a;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = activeView && activeView.file;
    if (!(activeFile instanceof TFile) || !activeView || activeFile.extension.toLowerCase() !== "md") {
      new Notice("Open a transcript markdown note first.");
      return;
    }
    try {
      const content = await this.app.vault.read(activeFile);
      const region = findEntryRegionAtPosition(content, activeView.editor.getCursor());
      if (!region || !((_a = region.meta) == null ? void 0 : _a.id)) {
        new Notice("No transcription entry found at cursor.");
        return;
      }
      const entryContent = content.slice(region.start, region.end);
      if (hasEntrySpeakerMappingSection(entryContent, (region.meta as any).id)) {
        new Notice("Speaker Mapping section already exists in this transcription.");
        return;
      }
      const labels = extractSpeakerLabels(entryContent);
      if (labels.length === 0) {
        new Notice("No diarized speaker labels found in this transcription.");
        return;
      }
      const section = buildEntrySpeakerMappingSection(labels, (region.meta as any).id).trimEnd();
      const calloutSection = section.split("\n").map((line) => line.trim().length > 0 ? `> ${line}` : ">").join("\n");
      const injection = `${calloutSection}
>
`;
      const calloutHeaderMatch = /(>\[![^\]]+\][^\n]*)(\n|$)/.exec(entryContent);
      if (!calloutHeaderMatch || calloutHeaderMatch.index === void 0) {
        new Notice("Could not find transcription callout in this entry.");
        return;
      }
      const insertOffsetInEntry = calloutHeaderMatch.index + calloutHeaderMatch[0].length;
      const insertOffset = region.start + insertOffsetInEntry;
      const updated = `${content.slice(0, insertOffset)}${injection}${content.slice(insertOffset)}`;
      await this.app.vault.modify(activeFile, updated);
      new Notice(`Speaker Mapping created for ${labels.length} speaker(s).`);
    } catch (e) {
      new Notice("Failed to generate Speaker Mapping for this note.");
    }
  }
  async renameCurrentTranscriptionEntry() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = activeView && activeView.file;
    if (!(activeFile instanceof TFile) || !activeView || activeFile.extension.toLowerCase() !== "md") {
      new Notice("Open a transcript markdown note first.");
      return;
    }
    const newTitleRaw = window.prompt("Enter transcription title");
    if (newTitleRaw === null)
      return;
    const newTitle = newTitleRaw.trim();
    if (!newTitle) {
      new Notice("Title cannot be empty.");
      return;
    }
    try {
      const content = await this.app.vault.read(activeFile);
      const region = findEntryRegionAtPosition(content, activeView.editor.getCursor());
      if (!region) {
        new Notice("No transcription entry found at cursor.");
        return;
      }
      const entry = content.slice(region.start, region.end);
      const updatedEntry = this.updateEntryTitle(entry, newTitle);
      if (updatedEntry === entry) {
        new Notice("Could not update this transcription entry title.");
        return;
      }
      const updated = `${content.slice(0, region.start)}${updatedEntry}${content.slice(region.end)}`;
      await this.app.vault.modify(activeFile, updated);
      new Notice("Transcription entry title updated.");
    } catch (e) {
      new Notice("Failed to rename transcription entry.");
    }
  }
  updateEntryTitle(entryContent: any, title: any) {
    let updated = entryContent;
    const compactMarkerRegex = /<!--\s*neurovox:entry:({[\s\S]*?})\s*-->/;
    const compactMarkerMatch = updated.match(compactMarkerRegex);
    if (compactMarkerMatch == null ? void 0 : compactMarkerMatch[1]) {
      try {
        const parsed = JSON.parse(compactMarkerMatch[1]);
        parsed.title = title;
        updated = updated.replace(
          compactMarkerRegex,
          `<!-- neurovox:entry:${JSON.stringify(parsed)} -->`
        );
      } catch (e) {
      }
    }
    const metaRegex = /<!--\s*neurovox:entry-meta:({[\s\S]*?})\s*-->/;
    const metaMatch = updated.match(metaRegex);
    if (metaMatch == null ? void 0 : metaMatch[1]) {
      try {
        const parsed = JSON.parse(metaMatch[1]);
        parsed.title = title;
        updated = updated.replace(metaRegex, `<!-- neurovox:entry-meta:${JSON.stringify(parsed)} -->`);
      } catch (e) {
      }
    }
    const calloutRegex = /(^|\n)(>\[![^\]]+\][^\n]*)/;
    const calloutMatch = calloutRegex.exec(updated);
    if (calloutMatch) {
      const original = calloutMatch[2];
      const replaced = original.replace(/(>\[![^\]]+\][-+])\s*.*/, `$1 ${title}`);
      if (replaced !== original) {
        return updated.replace(original, replaced);
      }
      const fallback = original.replace(/(>\[![^\]]+\])\s*.*/, `$1- ${title}`);
      return updated.replace(original, fallback);
    }
    return updated;
  }
  insertSpeakerMappingAfterFrontmatter(content: any, section: any) {
    const frontmatterMatch = /^---\n[\s\S]*?\n---\n?/.exec(content);
    if (!frontmatterMatch || frontmatterMatch.index !== 0) {
      return `${section}${content}`;
    }
    const end = frontmatterMatch[0].length;
    const prefix = content.slice(0, end);
    const suffix = content.slice(end);
    const spacer = suffix.startsWith("\n") ? "" : "\n";
    return `${prefix}${spacer}${section}${suffix}`;
  }
  async writeDeepgramDiagnosticReport(diagnosis: any, sourcePath: any) {
    const adapter = this.app.vault.adapter;
    const baseDir = normalizePath("neurovox/diagnostics");
    if (!await adapter.exists(baseDir)) {
      await adapter.mkdir(baseDir);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = normalizePath(`${baseDir}/deepgram-diagnosis-${stamp}.md`);
    const body = [
      "---",
      `date: ${new Date().toISOString()}`,
      "type: deepgram-diagnosis",
      `source: ${sourcePath}`,
      `provider: ${this.settings.transcriptionProvider}`,
      `model: ${this.settings.transcriptionModel}`,
      "---",
      "",
      "# Deepgram Diarization Diagnosis",
      "",
      "```json",
      JSON.stringify(diagnosis, null, 2),
      "```",
      ""
    ].join("\n");
    await this.app.vault.create(filePath, body);
    return filePath;
  }
  /**
   * Refreshes all floating buttons based on current settings
   * This ensures UI is in sync with settings when they change
   */
  refreshFloatingButtons() {
    this.events.trigger("floating-button-setting-changed", this.settings.showFloatingButton);
  }
  onunload() {
    RecordingProcessor.instance = null;
    this.saveSettings().catch(() => {
    });
    if (this.processingInterval !== null) {
      window.clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    if (this.statusReconcileInterval !== null) {
      window.clearInterval(this.statusReconcileInterval);
      this.statusReconcileInterval = null;
    }
    this.speakerAutoApplyDebounceTimers.forEach((timer: any) => {
      window.clearTimeout(timer);
    });
    this.speakerAutoApplyDebounceTimers.clear();
    this.speakerAutoApplyInFlight.clear();
    if (this.modalInstance) {
      this.modalInstance.close();
      this.modalInstance = null;
    }
    if (this.ribbonController) {
      this.ribbonController.dispose();
      this.ribbonController = null;
    }
    this.cleanupUI();
  }
}

export default NeuroVoxPlugin;
