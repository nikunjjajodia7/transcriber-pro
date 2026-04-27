import { MarkdownView, Notice } from 'obsidian';
import { AudioRecordingManager } from '../utils/RecordingManager';
import { DeviceDetection } from '../utils/DeviceDetection';
import { StreamingTranscriptionService } from '../utils/transcription/StreamingTranscriptionService';
import { UploadBottomSheet } from './UploadBottomSheet';

type RibbonState = 'idle' | 'recording' | 'processing';

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
  private headerAction: HTMLElement | null = null;

  private state: RibbonState = 'idle';
  private currentNotice: Notice | null = null;
  private timerInterval: number | null = null;
  private recordingStartedAt: number = 0;
  private recordingManager: any = null;
  private streamingService: any = null;
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
      (leaf: any) => this.refreshHeaderAction(leaf)
    );
    this.plugin.registerEvent(this.leafChangeRef);
    this.refreshHeaderAction(this.plugin.app.workspace.activeLeaf);
  }

  private refreshHeaderAction(leaf: any) {
    if (this.headerAction) {
      try {
        this.headerAction.remove();
      } catch (_) {
        // ignore — element may already be detached by Obsidian
      }
      this.headerAction = null;
    }
    if (!leaf || !(leaf.view instanceof MarkdownView)) return;
    const view = leaf.view as MarkdownView;
    this.headerAction = view.addAction(
      'mic',
      'Start recording',
      (evt: MouseEvent) => this.onRecordTap(evt)
    );
  }

  async onRecordTap(_evt: MouseEvent) {
    if (this.state !== 'idle') {
      // Already recording or processing — guard against double-fire from the
      // ribbon icon, the header action, or a rapid second tap.
      return;
    }
    await this.startRecordingSession();
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
          }
        });
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
    const initialMessage = this.formatRecordingMessage(0);
    this.currentNotice = new Notice(initialMessage, 0);
    const noticeEl = this.currentNotice.noticeEl;
    noticeEl.classList.add('neurovox-recording-notice');
    this.attachStopHandler(noticeEl);
    this.timerInterval = window.setInterval(() => {
      if (!this.currentNotice) return;
      const elapsedSec = Math.floor((Date.now() - this.recordingStartedAt) / 1000);
      this.currentNotice.setMessage(this.formatRecordingMessage(elapsedSec, this.getInterimTail()));
      // Belt-and-suspenders: if Obsidian rebuilt noticeEl on setMessage, the
      // dataset flag is gone and we re-bind. If the element is the same, the
      // guard inside attachStopHandler short-circuits.
      this.attachStopHandler(this.currentNotice.noticeEl);
    }, 1000);
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
    if (this.state !== 'recording') return;
    await this.finishRecordingSession();
  }

  private async finishRecordingSession() {
    const elapsedSec = Math.floor((Date.now() - this.recordingStartedAt) / 1000);
    this.stopRecordingTimer();
    this.state = 'processing';
    this.showProcessingNotice('Transcribing...');
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
    } catch (error) {
      if (this.streamingService) {
        const message = error instanceof Error ? error.message : String(error);
        this.streamingService.abort(`finalize_failed:${message}`);
        this.streamingService = null;
      }
      this.handleFailure('Failed to stop recording', error);
    } finally {
      this.hideCurrentNotice();
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

  private stopRecordingIndicator() {
    this.stopRecordingTimer();
    this.hideCurrentNotice();
    this.recordingStartedAt = 0;
    this.state = 'idle';
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

  private formatRecordingMessage(elapsedSec: number, interimTail = ''): string {
    const base = `\u{1F534} REC ${this.formatMmSs(elapsedSec)} · Tap to stop`;
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
    if (this.streamingService) {
      this.streamingService.abort(detail);
      this.streamingService = null;
    }
    this.resetRecordingState();
    this.stopRecordingIndicator();
  }

  private resetRecordingState() {
    this.recordingStartedAt = 0;
    this.liveAudioCaptureActive = false;
    this.activeFile = null;
    this.cursorPosition = null;
    if (this.recordingManager) {
      this.recordingManager.cleanup();
      this.recordingManager = null;
    }
  }

  dispose() {
    this.stopRecordingIndicator();
    if (this.streamingService) {
      this.streamingService.abort('plugin_unload');
      this.streamingService = null;
    }
    this.resetRecordingState();
    for (const el of this.ribbonElements) {
      try {
        el.remove();
      } catch (_) {
        // ignore — Obsidian may have already cleaned the element
      }
    }
    this.ribbonElements = [];
    if (this.headerAction) {
      try {
        this.headerAction.remove();
      } catch (_) {
        // ignore
      }
      this.headerAction = null;
    }
    if (this.leafChangeRef) {
      try {
        this.plugin.app.workspace.offref(this.leafChangeRef);
      } catch (_) {
        // ignore — registerEvent will also clean on plugin unload
      }
      this.leafChangeRef = null;
    }
  }
}
