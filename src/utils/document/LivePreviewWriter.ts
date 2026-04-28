import { Notice } from 'obsidian';
import { DocumentInserter } from './DocumentInserter';

// Owns the per-recording lifecycle of the in-note "live transcription" callout
// block. Three controllers (MobileDockPill, DesktopDockPill, RibbonRecorderController)
// previously each carried their own copy of the chain-of-promises write logic;
// this helper consolidates them so the chunk-cadence write contract has one
// canonical implementation and one place to fix bugs going forward.
//
// Caller passes in `markerId` (typically `streamingService.getRecoveryJobId()`).
// The same id must be used by `RecordingProcessor` checkpoints, otherwise the
// post-crash sweep at `main.ts:cleanupStaleLivePreviewInVault` still cleans
// markers but the recovery modal won't correlate them to a session. That
// parity is the caller's responsibility, not enforced here.
//
// Failure contract (D2): individual `vault.modify` calls that throw (file
// moved, deleted, locked, vault revision races, etc.) are swallowed so the
// streaming chunk pipeline keeps flowing, but the FIRST failure surfaces a
// single user-visible Notice so a stale callout is never silent.
//
// Close contract (D1): once `close()` is called, subsequent `enqueue()` calls
// short-circuit. This closes the race where a final streaming chunk callback
// fires after `clear()` runs and re-inserts a block post-removal (the cancel
// path in particular, which doesn't go through `RecordingProcessor`'s strip).
export class LivePreviewWriter {
  plugin: any;
  file: any;
  cursorPosition: any;
  markerId: any;
  documentInserter: DocumentInserter;
  writeChain: Promise<any>;
  closed: boolean;
  firstFailureSurfaced: boolean;

  constructor(plugin: any, file: any, cursorPosition: any, markerId: any) {
    this.plugin = plugin;
    this.file = file;
    this.cursorPosition = cursorPosition;
    this.markerId = markerId;
    this.documentInserter = new DocumentInserter(plugin);
    this.writeChain = Promise.resolve();
    this.closed = false;
    this.firstFailureSurfaced = false;
  }

  async enqueue(partial: any): Promise<void> {
    if (this.closed) return;
    if (!this.markerId) return;
    this.writeChain = this.writeChain.then(async () => {
      if (this.closed) return;
      try {
        await this.documentInserter.upsertLiveTranscriptionBlock(
          this.file,
          this.cursorPosition,
          this.markerId,
          partial
        );
      } catch (error) {
        this.handleWriteFailure(error);
      }
    });
    await this.writeChain;
  }

  async clear(): Promise<void> {
    if (!this.markerId) return;
    await this.writeChain.catch(() => {});
    try {
      await this.documentInserter.removeLiveTranscriptionBlock(this.file, this.markerId);
    } catch (_) {
      // Removal failures are non-fatal — the on-load sweep at main.ts will
      // catch any orphaned markers.
    }
  }

  close(): void {
    this.closed = true;
  }

  private handleWriteFailure(error: any) {
    if (!this.firstFailureSurfaced) {
      this.firstFailureSurfaced = true;
      const detail = error instanceof Error ? error.message : String(error);
      console.warn('[neurovox] Live preview write failed:', detail);
      new Notice('Live preview detached — recording continues');
    }
  }
}
