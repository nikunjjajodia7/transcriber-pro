import { MarkdownView, Notice } from 'obsidian';

type RibbonState = 'idle' | 'recording' | 'processing';

// Owns the mobile ribbon recorder surface: two ribbon icons (record / upload),
// a 1-tap header action on the active MarkdownView, and a persistent Notice
// indicator that tracks recording state. Replaces the floating mic on mobile
// when `recorderMode === 'ribbon'` so iOS positioning math stops fighting the
// keyboard.
//
// Unit 2: lifecycle scaffold + ribbon icons (no recording).
// Unit 3 (this commit): persistent Notice + 1Hz timer + tap-to-stop.
// Unit 4: real recording wire-up (StreamingTranscriptionService).
// Unit 6: real upload wire-up (UploadBottomSheet).
export class RibbonRecorderController {
  plugin: any;
  private ribbonElements: HTMLElement[] = [];
  private leafChangeRef: any = null;
  private headerAction: HTMLElement | null = null;

  private state: RibbonState = 'idle';
  private currentNotice: Notice | null = null;
  private timerInterval: number | null = null;
  private recordingStartedAt: number = 0;

  constructor(plugin: any) {
    this.plugin = plugin;
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

  onRecordTap(_evt: MouseEvent) {
    if (this.state !== 'idle') {
      // Already recording or processing — guard against double-fire from the
      // ribbon icon, the header action, or a rapid second tap.
      return;
    }
    this.startRecordingIndicator();
  }

  // Stub — Unit 6 replicates MobileDockPill.handleUploadTap.
  onUploadTap(_evt: MouseEvent) {
    console.debug('[NeuroVox][Ribbon] onUploadTap (Unit 2 stub)');
  }

  // For Unit 3 this is invoked directly from the ribbon. Unit 4 will wrap it
  // around the StreamingTranscriptionService start so the indicator only
  // appears after permission resolves and the live session begins.
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
      this.currentNotice.setMessage(this.formatRecordingMessage(elapsedSec));
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

  onStopTap() {
    if (this.state !== 'recording') return;
    this.stopRecordingIndicator();
  }

  private stopRecordingIndicator() {
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.currentNotice) {
      try {
        this.currentNotice.hide();
      } catch (_) {
        // ignore — Obsidian may have already cleaned the element
      }
      this.currentNotice = null;
    }
    this.recordingStartedAt = 0;
    this.state = 'idle';
  }

  private formatRecordingMessage(elapsedSec: number): string {
    return `\u{1F534} REC ${this.formatMmSs(elapsedSec)} · Tap to stop`;
  }

  private formatMmSs(sec: number): string {
    const safe = Math.max(0, sec);
    const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
    const seconds = (safe % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  dispose() {
    this.stopRecordingIndicator();
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
