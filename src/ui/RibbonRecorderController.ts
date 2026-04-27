import { MarkdownView } from 'obsidian';

// Owns the mobile ribbon recorder surface: two ribbon icons (record / upload)
// plus a 1-tap header action on the active MarkdownView. Replaces the
// floating mic on mobile when `recorderMode === 'ribbon'` so iOS positioning
// math stops fighting the keyboard. This file ships in Unit 2 with stub
// handlers; Unit 3 adds the persistent Notice indicator and Unit 4 wires up
// real recording.
export class RibbonRecorderController {
  plugin: any;
  private ribbonElements: HTMLElement[] = [];
  private leafChangeRef: any = null;
  private headerAction: HTMLElement | null = null;

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

  // Stub; Unit 3 swaps in Notice + timer, Unit 4 wires StreamingTranscriptionService.
  onRecordTap(_evt: MouseEvent) {
    console.debug('[NeuroVox][Ribbon] onRecordTap (Unit 2 stub)');
  }

  // Stub; Unit 6 replicates MobileDockPill.handleUploadTap.
  onUploadTap(_evt: MouseEvent) {
    console.debug('[NeuroVox][Ribbon] onUploadTap (Unit 2 stub)');
  }

  dispose() {
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
