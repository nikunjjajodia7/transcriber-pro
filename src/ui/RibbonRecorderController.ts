import { MarkdownView, Notice } from 'obsidian';
import { AudioRecordingManager } from '../utils/RecordingManager';
import { DeviceDetection } from '../utils/DeviceDetection';
import { LivePreviewWriter } from '../utils/document/LivePreviewWriter';
import { StreamingTranscriptionService } from '../utils/transcription/StreamingTranscriptionService';
import { UploadBottomSheet } from './UploadBottomSheet';

type RibbonState = 'idle' | 'recording' | 'paused' | 'processing';

// Owns the mobile ribbon recorder surface: two ribbon icons (record / upload),
// a 1-tap header action on the active MarkdownView, and a persistent Notice
// indicator that tracks recording state. Replaces the floating mic on mobile
// when `recorderMode === 'ribbon'` so iOS positioning math stops fighting the
// keyboard.
//
// Uses the same recording/upload pipeline as MobileDockPill, but lets
// Obsidian own the mobile positioning surface.
export class RibbonRecorderController {
  plugin: any;
  private ribbonElements: HTMLElement[] = [];
  private leafChangeRef: any = null;
  private layoutChangeRef: any = null;
  private micAction: HTMLElement | null = null;
  private uploadAction: HTMLElement | null = null;
  private pauseAction: HTMLElement | null = null;
  private resumeAction: HTMLElement | null = null;
  private stopAction: HTMLElement | null = null;

  private state: RibbonState = 'idle';
  private currentNotice: Notice | null = null;
  private timerInterval: number | null = null;
  private recordingStartedAt: number = 0;
  private elapsedBeforePauseSec: number = 0;
  private recordingManager: any = null;
  private streamingService: any = null;
  private livePreviewWriter: any = null;
  private activeFile: any = null;
  private cursorPosition: any = null;
  private saveAudioOn: boolean = false;
  private useStreaming: boolean = true;
  private liveAudioCaptureActive: boolean = false;
  private uploadSheet: any = null;

  static RECORDER_STOP_TIMEOUT_MS = 12e3;

  constructor(plugin: any) {
    this.plugin = plugin;
    const deviceDetection = DeviceDetection.getInstance();
    this.saveAudioOn = this.plugin.settings.saveLiveRecordingAudio || false;
    this.useStreaming = this.plugin.settings.streamingMode != null
      ? this.plugin.settings.streamingMode
      : deviceDetection.shouldUseStreamingMode();
  }

  register() {
    const onRecord = (evt: MouseEvent) => this.onRecordTap(evt);
    const onUpload = (evt: MouseEvent) => this.onUploadTap(evt);
    this.ribbonElements.push(
      this.plugin.addRibbonIcon('mic', 'Start recording', onRecord)
    );
    this.ribbonElements.push(
      this.plugin.addRibbonIcon('upload-cloud', 'Upload recording', onUpload)
    );
    this.leafChangeRef = this.plugin.app.workspace.on(
      'active-leaf-change',
      (leaf: any) => this.refreshHeaderActions(leaf)
    );
    this.plugin.registerEvent(this.leafChangeRef);
    this.layoutChangeRef = this.plugin.app.workspace.on(
      'layout-change',
      () => this.refreshHeaderActions(this.plugin.app.workspace.activeLeaf)
    );
    this.plugin.registerEvent(this.layoutChangeRef);
    this.refreshHeaderActions(this.plugin.app.workspace.activeLeaf);
  }

  private refreshHeaderActions(leaf: any = this.plugin.app.workspace.activeLeaf) {
    this.detachHeaderActions();
    if (!leaf || !(leaf.view instanceof MarkdownView)) return;
    const view = leaf.view as MarkdownView;
    if (this.state === 'idle') {
      this.micAction = view.addAction(
        'mic',
        'Start recording',
        (evt: MouseEvent) => this.onRecordTap(evt)
      );
      this.uploadAction = view.addAction(
        'upload-cloud',
        'Upload recording',
        (evt: MouseEvent) => this.onUploadTap(evt)
      );
      return;
    }
    if (this.state === 'recording') {
      this.pauseAction = view.addAction(
        'pause',
        'Pause recording',
        (evt: MouseEvent) => this.onPauseResumeTap(evt)
      );
      this.stopAction = view.addAction(
        'square',
        'Stop recording',
        () => this.onStopTap()
      );
      return;
    }
    if (this.state === 'paused') {
      this.resumeAction = view.addAction(
        'play',
        'Resume recording',
        (evt: MouseEvent) => this.onPauseResumeTap(evt)
      );
      this.stopAction = view.addAction(
        'square',
        'Stop recording',
        () => this.onStopTap()
      );
    }
  }

  private detachHeaderActions() {
    const actions = [
      this.micAction,
      this.uploadAction,
      this.pauseAction,
      this.resumeAction,
      this.stopAction
    ];
    for (const action of actions) {
      if (!action) continue;
      try {
        action.detach();
      } catch (_) {
        try {
          action.remove();
        } catch (_) {
          // ignore — Obsidian may have already cleaned the element
        }
      }
    }
    this.micAction = null;
    this.uploadAction = null;
    this.pauseAction = null;
    this.resumeAction = null;
    this.stopAction = null;
  }

  async onRecordTap(_evt: MouseEvent) {
    if (this.state !== 'idle') {
      // Already recording or processing — guard against double-fire from the
      // ribbon icon, the header action, or a rapid second tap.
      return;
    }
    await this.startRecordingSession();
  }

  getState() {
    return this.state;
  }

  canStartRecording() {
    return this.state === 'idle';
  }

  canStopRecording() {
    return this.state === 'recording' || this.state === 'paused';
  }

  canPauseOrResume() {
    return this.state === 'recording' || this.state === 'paused';
  }

  onUploadTap(_evt: MouseEvent) {
    if (this.state !== 'idle') {
      new Notice('Finish the current recording first.');
      return;
    }
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.file) {
      new Notice('No active note found to insert transcription.');
      return;
    }
    this.activeFile = activeView.file;
    this.cursorPosition = activeView.editor.getCursor();
    this.uploadSheet = new UploadBottomSheet({
      plugin: this.plugin,
      saveAudioOn: this.saveAudioOn,
      onTranscribe: (file: any, saveAudio: any) => {
        this.saveAudioOn = saveAudio;
        this.plugin.settings.saveLiveRecordingAudio = saveAudio;
        void this.plugin.saveSettings({ refreshUi: false, triggerFloatingRefresh: false }).catch(() => {});
        void this.processUploadedFile(file);
      },
      onCancel: () => {
        this.uploadSheet = null;
      }
    });
    this.uploadSheet.open();
  }

  private async processUploadedFile(file: any) {
    try {
      this.state = 'processing';
      this.refreshHeaderActions();
      this.showProcessingNotice('Transcribing uploaded audio...');
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'audio/wav' });
      await this.plugin.recordingProcessor.processRecording(blob, this.activeFile, this.cursorPosition, file.name);
      new Notice(`Transcribed uploaded audio: ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to transcribe: ${message}`);
    } finally {
      this.hideCurrentNotice();
      this.state = 'idle';
      this.uploadSheet = null;
      this.refreshHeaderActions();
    }
  }

  private async startRecordingSession() {
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.file) {
      new Notice('No active note found to insert transcription.');
      return;
    }
    this.activeFile = activeView.file;
    this.cursorPosition = activeView.editor.getCursor();
    this.state = 'processing';
    this.refreshHeaderActions();
    const pendingNotice = new Notice('Requesting microphone...', 0);
    try {
      if (!this.recordingManager) {
        this.recordingManager = new AudioRecordingManager(this.plugin);
      }
      await this.recordingManager.initialize();
      if (this.useStreaming && !this.streamingService) {
        this.streamingService = new StreamingTranscriptionService(this.plugin, {
          onMemoryWarning: (usage: any) => {
            new Notice(`Memory usage high: ${Math.round(usage)}%`);
          },
          onChunkCommitted: async (_chunkText: any, _metadata: any, partialResult: any) => {
            if (!this.plugin.settings.showLiveChunkPreviewInNote) return;
            await this.livePreviewWriter?.enqueue(partialResult);
          }
        });
        this.livePreviewWriter = new LivePreviewWriter(
          this.plugin,
          this.activeFile,
          this.cursorPosition,
          this.streamingService.getRecoveryJobId()
        );
      }
      if (this.useStreaming && this.streamingService) {
        const stream = this.recordingManager.getStream();
        if (!stream) throw new Error('Microphone stream unavailable');
        await this.streamingService.startLiveSession(stream);
        if (this.saveAudioOn && !this.liveAudioCaptureActive) {
          this.recordingManager.start();
          this.liveAudioCaptureActive = true;
        }
      } else {
        this.recordingManager.start();
      }
      pendingNotice.hide();
      this.startRecordingIndicator();
      new Notice('Recording started');
    } catch (error) {
      pendingNotice.hide();
      this.handleFailure('Failed to start recording', error);
    }
  }

  private startRecordingIndicator() {
    this.state = 'recording';
    this.recordingStartedAt = Date.now();
    this.elapsedBeforePauseSec = 0;
    const initialMessage = this.formatRecordingMessage(0);
    this.currentNotice = new Notice(initialMessage, 0);
    const noticeEl = this.currentNotice.noticeEl;
    noticeEl.classList.add('neurovox-recording-notice');
    this.attachStopHandler(noticeEl);
    this.startRecordingTimer();
    this.refreshHeaderActions();
  }

  private attachStopHandler(noticeEl: HTMLElement) {
    if (noticeEl.dataset.neurovoxBound === '1') return;
    noticeEl.dataset.neurovoxBound = '1';
    this.plugin.registerDomEvent(noticeEl, 'click', (evt: MouseEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.onStopTap();
    });
  }

  async onStopTap() {
    if (!this.canStopRecording()) return;
    await this.finishRecordingSession();
  }

  onPauseResumeTap(_evt?: MouseEvent) {
    if (!this.canPauseOrResume()) return;
    try {
      if (this.state === 'paused') {
        if (this.useStreaming && this.streamingService) {
          this.streamingService.resumeLive();
          if (this.liveAudioCaptureActive) this.recordingManager.resume();
        } else {
          this.recordingManager.resume();
        }
        this.recordingStartedAt = Date.now() - this.elapsedBeforePauseSec * 1000;
        this.state = 'recording';
        this.startRecordingTimer();
      } else {
        if (this.useStreaming && this.streamingService) {
          this.streamingService.pauseLive();
          if (this.liveAudioCaptureActive) this.recordingManager.pause();
        } else {
          this.recordingManager.pause();
        }
        this.elapsedBeforePauseSec = this.getElapsedSeconds();
        this.stopRecordingTimer();
        this.state = 'paused';
      }
      this.updateRecordingNotice();
      this.refreshHeaderActions();
    } catch (error) {
      this.handleFailure('Failed to pause/resume', error);
    }
  }

  private async finishRecordingSession() {
    const elapsedSec = this.getElapsedSeconds();
    this.stopRecordingTimer();
    this.state = 'processing';
    this.refreshHeaderActions();
    this.showProcessingNotice('Transcribing...');
    this.livePreviewWriter?.close();
    const writerForCleanup = this.livePreviewWriter;
    try {
      let finalBlob = null;
      if (this.useStreaming) {
        if (this.liveAudioCaptureActive) {
          finalBlob = await this.stopRecorderWithTimeout();
          this.liveAudioCaptureActive = false;
        }
      } else {
        finalBlob = await this.stopRecorderWithTimeout();
      }
      if (this.useStreaming && this.streamingService) {
        const result = await this.streamingService.finishProcessing();
        this.streamingService = null;
        if (!result.trim()) throw new Error('No transcription result received');
        await this.plugin.recordingProcessor.processStreamingResult(
          result,
          this.activeFile,
          this.cursorPosition,
          { audioBlob: this.saveAudioOn ? finalBlob || void 0 : void 0, durationSeconds: elapsedSec }
        );
      } else {
        if (!finalBlob) throw new Error('No audio data received from recorder');
        await this.plugin.recordingProcessor.processRecording(finalBlob, this.activeFile, this.cursorPosition);
      }
      this.resetRecordingState();
      this.state = 'idle';
      this.refreshHeaderActions();
    } catch (error) {
      if (this.streamingService) {
        const message = error instanceof Error ? error.message : String(error);
        this.streamingService.abort(`finalize_failed:${message}`);
        this.streamingService = null;
      }
      this.handleFailure('Failed to stop recording', error);
    } finally {
      this.hideCurrentNotice();
      if (writerForCleanup) {
        await writerForCleanup.clear();
      }
    }
  }

  private async stopRecorderWithTimeout() {
    return await Promise.race([
      this.recordingManager.stop(),
      new Promise((_, reject) => window.setTimeout(
        () => reject(new Error('Recorder stop timed out')),
        RibbonRecorderController.RECORDER_STOP_TIMEOUT_MS
      ))
    ]);
  }

  private stopRecordingTimer() {
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private startRecordingTimer() {
    this.stopRecordingTimer();
    this.timerInterval = window.setInterval(() => this.updateRecordingNotice(), 1000);
  }

  private updateRecordingNotice() {
    if (!this.currentNotice) return;
    const elapsedSec = this.getElapsedSeconds();
    this.currentNotice.setMessage(
      this.formatRecordingMessage(elapsedSec, this.getInterimTail(), this.state === 'paused')
    );
    // Belt-and-suspenders: if Obsidian rebuilt noticeEl on setMessage, the
    // dataset flag is gone and we re-bind. If the element is the same, the
    // guard inside attachStopHandler short-circuits.
    this.attachStopHandler(this.currentNotice.noticeEl);
  }

  private getElapsedSeconds() {
    if (this.state === 'paused') return this.elapsedBeforePauseSec;
    if (!this.recordingStartedAt) return 0;
    return Math.floor((Date.now() - this.recordingStartedAt) / 1000);
  }

  private stopRecordingIndicator() {
    this.stopRecordingTimer();
    this.hideCurrentNotice();
    this.recordingStartedAt = 0;
    this.elapsedBeforePauseSec = 0;
    this.state = 'idle';
    this.refreshHeaderActions();
  }

  private showProcessingNotice(message: string) {
    this.hideCurrentNotice();
    this.currentNotice = new Notice(message, 0);
    this.currentNotice.noticeEl.classList.add('neurovox-recording-notice');
  }

  private hideCurrentNotice() {
    if (this.currentNotice) {
      try {
        this.currentNotice.hide();
      } catch (_) {
        // ignore — Obsidian may have already cleaned the element
      }
      this.currentNotice = null;
    }
  }

  private getInterimTail(): string {
    if (!this.streamingService) return '';
    const partial = this.streamingService.getPartialResult();
    if (!partial || !partial.trim()) return '';
    const normalized = partial.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 50) return normalized;
    return `...${normalized.slice(-50)}`;
  }

  private formatRecordingMessage(elapsedSec: number, interimTail = '', paused = false): string {
    const base = paused
      ? `Paused ${this.formatMmSs(elapsedSec)} · Tap to stop`
      : `\u{1F534} REC ${this.formatMmSs(elapsedSec)} · Tap to stop`;
    return interimTail ? `${base}\n${interimTail}` : base;
  }

  private formatMmSs(sec: number): string {
    const safe = Math.max(0, sec);
    const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
    const seconds = (safe % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  private handleFailure(message: string, error: any) {
    const detail = error instanceof Error ? error.message : String(error);
    new Notice(`${message}: ${detail}`);
    const writer = this.livePreviewWriter;
    writer?.close();
    if (this.streamingService) {
      this.streamingService.abort(detail);
      this.streamingService = null;
    }
    this.resetRecordingState();
    this.stopRecordingIndicator();
    if (writer) {
      void writer.clear();
    }
  }

  private resetRecordingState() {
    this.recordingStartedAt = 0;
    this.elapsedBeforePauseSec = 0;
    this.liveAudioCaptureActive = false;
    this.activeFile = null;
    this.cursorPosition = null;
    this.livePreviewWriter = null;
    if (this.recordingManager) {
      this.recordingManager.cleanup();
      this.recordingManager = null;
    }
  }

  dispose() {
    const writer = this.livePreviewWriter;
    writer?.close();
    this.stopRecordingIndicator();
    if (this.streamingService) {
      this.streamingService.abort('plugin_unload');
      this.streamingService = null;
    }
    this.resetRecordingState();
    if (writer) {
      void writer.clear();
    }
    for (const el of this.ribbonElements) {
      try {
        el.remove();
      } catch (_) {
        // ignore — Obsidian may have already cleaned the element
      }
    }
    this.ribbonElements = [];
    if (this.leafChangeRef) {
      try {
        this.plugin.app.workspace.offref(this.leafChangeRef);
      } catch (_) {
        // ignore — registerEvent will also clean on plugin unload
      }
      this.leafChangeRef = null;
    }
    if (this.layoutChangeRef) {
      try {
        this.plugin.app.workspace.offref(this.layoutChangeRef);
      } catch (_) {
        // ignore — registerEvent will also clean on plugin unload
      }
      this.layoutChangeRef = null;
    }
    this.detachHeaderActions();
  }
}
