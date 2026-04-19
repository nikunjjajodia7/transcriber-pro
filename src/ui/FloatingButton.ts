import { MarkdownView, Modal, Notice, setIcon } from 'obsidian';
import { AudioRecordingManager } from '../utils/RecordingManager';
import { ButtonPositionManager } from '../utils/ButtonPositionManager';
import { DesktopDockPill } from './DesktopDockPill';
import { DeviceDetection } from '../utils/DeviceDetection';
import { InlineRecorderPanel } from './InlineRecorderPanel';
import { MobileDockPill } from './MobileDockPill';

export class FloatingButton {
  plugin: any;
  pluginData: any;
  onClickCallback: any;
  activeLeafContainer: any;
  resizeObserver: any;
  positionManager: any;
  resizeTimeout: any;
  audioManager: any;
  isRecording: any;
  isProcessing: any;
  inlineRecorderPanel: any;
  onPageDragOverBound: any;
  onPageDropBound: any;
  onMicDragOverBound: any;
  onMicDropBound: any;
  mobilePill: any;
  desktopPill: any;
  deviceDetection: any;
  isMobileDevice: any;
  mobileDefaultsEnsured: any;
  isDisposed: any;
  activeLeafRef: any;
  layoutChangeRef: any;
  resizeRef: any;
  buttonEl: any;
  containerEl: any;
  static instance: any = null;
  constructor(plugin: any, pluginData: any, onClickCallback: any) {
    this.plugin = plugin;
    this.pluginData = pluginData;
    this.onClickCallback = onClickCallback;
    this.activeLeafContainer = null;
    this.resizeObserver = null;
    this.positionManager = null;
    this.resizeTimeout = null;
    this.audioManager = null;
    this.isRecording = false;
    this.isProcessing = false;
    this.inlineRecorderPanel = null;
    this.onPageDragOverBound = null;
    this.onPageDropBound = null;
    this.onMicDragOverBound = null;
    this.onMicDropBound = null;
    this.mobilePill = null;
    this.desktopPill = null;
    this.deviceDetection = DeviceDetection.getInstance();
    this.isMobileDevice = this.deviceDetection.isMobile();
    this.mobileDefaultsEnsured = false;
    this.isDisposed = false;
    this.activeLeafRef = null;
    this.layoutChangeRef = null;
    this.resizeRef = null;
    if (FloatingButton.instance) {
      FloatingButton.instance.remove();
    }
    this.buttonEl = null;
    this.containerEl = null;
    this.initializeComponents();
  }
  static getInstance(plugin: any, pluginData: any, onClickCallback: any) {
    if (!FloatingButton.instance || FloatingButton.instance.isInvalid()) {
      if (FloatingButton.instance) {
        FloatingButton.instance.remove();
      }
      FloatingButton.instance = new FloatingButton(plugin, pluginData, onClickCallback);
    }
    return FloatingButton.instance;
  }
  isInvalid() {
    var _a, _b, _c, _d;
    if (this.isMobileDevice && this.mobilePill) {
      return !((_a = this.mobilePill.containerEl) == null ? void 0 : _a.isConnected);
    }
    if (this.desktopPill) {
      return !((_b = this.desktopPill.containerEl) == null ? void 0 : _b.isConnected);
    }
    return !((_c = this.containerEl) == null ? void 0 : _c.isConnected) || !((_d = this.buttonEl) == null ? void 0 : _d.isConnected);
  }
  getComputedSize() {
    const computedStyle = getComputedStyle(document.documentElement);
    return parseInt(computedStyle.getPropertyValue("--neurovox-button-size")) || 48;
  }
  getComputedMargin() {
    const computedStyle = getComputedStyle(document.documentElement);
    return parseInt(computedStyle.getPropertyValue("--neurovox-button-margin")) || 20;
  }
  getComputedResizeDelay() {
    const computedStyle = getComputedStyle(document.documentElement);
    return parseInt(computedStyle.getPropertyValue("--neurovox-resize-delay")) || 100;
  }
  initializeComponents() {
    if (!this.isMobileDevice) {
      this.setupResizeObserver();
    }
    this.createElements();
    this.setupWorkspaceEvents();
    if (this.isMobileDevice && this.mobilePill) {
      this.attachToActiveLeaf();
    }
  }
  setupResizeObserver() {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.activeLeafContainer && this.pluginData.showFloatingButton) {
        requestAnimationFrame(() => {
          if (this.positionManager) {
            this.positionManager.constrainPosition();
          }
        });
      }
    });
  }
  createElements() {
    if (this.isMobileDevice) {
      this.mobilePill = new MobileDockPill(this.plugin);
      this.mobilePill.onStateChange = (state: any) => {
        this.isRecording = state === "recording" || state === "paused" || state === "finalizing";
      };
      return;
    }
    this.desktopPill = new DesktopDockPill(this.plugin);
    this.desktopPill.onStateChange = (state: any) => {
      this.isRecording = state === "recording" || state === "paused" || state === "finalizing";
    };
    this.containerEl = this.desktopPill.getContainerEl();
    this.buttonEl = this.desktopPill.getButtonEl();
    this.buttonEl.addEventListener("click", (event: any) => {
      var _a, _b;
      if (((_a = this.positionManager) == null ? void 0 : _a.isDragging) || ((_b = this.positionManager) == null ? void 0 : _b.hasMoved)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.desktopPill.handlePillTap();
    });
    this.updateButtonColor();
    this.registerMicDropEvents();
    this.attachToActiveLeaf();
  }
  createContainer() {
    this.containerEl = document.createElement("div");
    this.containerEl.classList.add("neurovox-button-container");
    if (this.isMobileDevice) {
      this.containerEl.classList.add("is-mobile-dock");
    }
  }
  /* Handles button click events independently of drag behavior.
  * This ensures recording only starts on direct clicks, not after drags.
  */
  createButton() {
    if (!this.containerEl)
      return;
    this.buttonEl = document.createElement("button");
    this.buttonEl.classList.add("neurovox-button", "floating");
    if (this.isMobileDevice) {
      this.buttonEl.classList.add("is-mobile-dock");
      this.buttonEl.setAttribute("aria-label", "Open transcription actions");
    } else {
      this.buttonEl.setAttribute("aria-label", "Start recording (drag to move)");
    }
    setIcon(this.buttonEl, "mic");
    this.buttonEl.addEventListener("click", (event: any) => {
      var _a, _b;
      if (((_a = this.positionManager) == null ? void 0 : _a.isDragging) || ((_b = this.positionManager) == null ? void 0 : _b.hasMoved)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.handleClick();
    });
    this.updateButtonColor();
    if (!this.isMobileDevice) {
      this.registerMicDropEvents();
    }
    this.containerEl.appendChild(this.buttonEl);
  }
  registerMicDropEvents() {
    if (!this.buttonEl)
      return;
    if (this.onMicDragOverBound) {
      this.buttonEl.removeEventListener("dragover", this.onMicDragOverBound);
    }
    if (this.onMicDropBound) {
      this.buttonEl.removeEventListener("drop", this.onMicDropBound);
    }
    this.onMicDragOverBound = (event: any) => {
      var _a;
      if (!this.hasAudioFile(event.dataTransfer))
        return;
      event.preventDefault();
      (_a = this.buttonEl) == null ? void 0 : _a.addClass("drag-over");
    };
    this.onMicDropBound = (event: any) => {
      var _a;
      if (!this.hasAudioFile(event.dataTransfer))
        return;
      event.preventDefault();
      (_a = this.buttonEl) == null ? void 0 : _a.removeClass("drag-over");
      void this.handleDroppedAudio(event.dataTransfer, "mic");
    };
    this.buttonEl.addEventListener("dragover", this.onMicDragOverBound);
    this.buttonEl.addEventListener("drop", this.onMicDropBound);
    this.buttonEl.addEventListener("dragleave", () => {
      var _a;
      return (_a = this.buttonEl) == null ? void 0 : _a.removeClass("drag-over");
    });
  }
  async initializePositionManager() {
    if (this.isMobileDevice)
      return;
    if (!this.containerEl || !this.buttonEl || !this.activeLeafContainer)
      return;
    this.positionManager = new ButtonPositionManager(
      this.containerEl,
      this.buttonEl,
      this.activeLeafContainer,
      this.getComputedSize(),
      this.getComputedMargin(),
      this.handlePositionChange.bind(this),
      this.handleDragEnd.bind(this),
      this.onClickCallback
    );
    setTimeout(async () => {
      await this.setInitialPosition();
    }, 0);
  }
  handlePositionChange(x: any, y: any) {
    if (!this.containerEl)
      return;
    requestAnimationFrame(() => {
      var _a;
      if (this.containerEl) {
        this.containerEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      (_a = this.inlineRecorderPanel) == null ? void 0 : _a.updateAnchor({ x, y });
    });
  }
  async handleDragEnd(position: any) {
    this.pluginData.buttonPosition = position;
    await this.plugin.saveSettings({ refreshUi: false, triggerFloatingRefresh: false });
  }
  async setInitialPosition() {
    if (this.isMobileDevice)
      return;
    const savedPosition = this.pluginData.buttonPosition;
    if (savedPosition && this.activeLeafContainer && this.positionManager) {
      const containerRect = this.activeLeafContainer.getBoundingClientRect();
      const x = Math.min(
        Math.max(savedPosition.x, this.getComputedMargin()),
        containerRect.width - this.getComputedSize() - this.getComputedMargin()
      );
      const y = Math.min(
        Math.max(savedPosition.y, this.getComputedMargin()),
        containerRect.height - this.getComputedSize() - this.getComputedMargin()
      );
      requestAnimationFrame(() => {
        if (this.positionManager) {
          this.positionManager.setPosition(x, y, true);
        }
      });
    } else {
      await this.setDefaultPosition();
    }
  }
  async setDefaultPosition() {
    if (this.isMobileDevice)
      return;
    if (!this.activeLeafContainer || !this.positionManager) {
      return;
    }
    const containerRect = this.activeLeafContainer.getBoundingClientRect();
    const x = containerRect.width - this.getComputedSize() - this.getComputedMargin();
    const y = containerRect.height - this.getComputedSize() - this.getComputedMargin();
    requestAnimationFrame(() => {
      if (this.positionManager) {
        this.positionManager.setPosition(x, y, true);
        this.pluginData.buttonPosition = { x, y };
        this.plugin.saveSettings({ refreshUi: false, triggerFloatingRefresh: false });
      }
    });
  }
  setupWorkspaceEvents() {
    this.registerActiveLeafChangeEvent();
    this.registerLayoutChangeEvent();
    this.registerResizeEvent();
  }
  registerActiveLeafChangeEvent() {
    this.activeLeafRef = this.plugin.app.workspace.on("active-leaf-change", () => {
      if (this.isDisposed) return;
      requestAnimationFrame(() => {
        if (this.isDisposed) return;
        this.attachToActiveLeaf();
      });
    });
    this.plugin.registerEvent(this.activeLeafRef);
  }
  registerLayoutChangeEvent() {
    this.layoutChangeRef = this.plugin.app.workspace.on("layout-change", () => {
      if (this.isDisposed) return;
      requestAnimationFrame(() => {
        if (this.isDisposed) return;
        if (this.positionManager && this.activeLeafContainer) {
          this.positionManager.updateContainer(this.activeLeafContainer);
        }
        if (this.mobilePill) {
          this.mobilePill.measureAndPositionAboveDock();
        }
      });
    });
    this.plugin.registerEvent(this.layoutChangeRef);
  }
  registerResizeEvent() {
    this.resizeRef = this.plugin.app.workspace.on("resize", () => {
      if (this.isDisposed) return;
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }
      this.resizeTimeout = setTimeout(() => {
        if (this.isDisposed) return;
        if (this.activeLeafContainer && this.positionManager) {
          requestAnimationFrame(() => {
            if (this.isDisposed) return;
            if (this.positionManager && this.activeLeafContainer) {
              this.positionManager.updateContainer(this.activeLeafContainer);
            }
          });
        }
        if (this.mobilePill) {
          this.mobilePill.measureAndPositionAboveDock();
        }
      }, this.getComputedResizeDelay());
    });
    this.plugin.registerEvent(this.resizeRef);
  }
  attachToActiveLeaf() {
    if (this.isDisposed) return;
    if (this.isMobileDevice && this.mobilePill) {
      const activeLeaf = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeLeaf) {
        this.mobilePill.hide();
        return;
      }
      const viewContent = activeLeaf.containerEl.querySelector(".view-content");
      if (!(viewContent instanceof HTMLElement)) {
        this.mobilePill.hide();
        return;
      }
      this.activeLeafContainer = viewContent;
      this.mobilePill.attachTo(viewContent);
      if (this.plugin.settings.showFloatingButton) {
        this.mobilePill.show();
      } else {
        this.mobilePill.hide();
      }
      return;
    }
    const activeLeaf = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeLeaf) {
      return;
    }
    const viewContent = activeLeaf.containerEl.querySelector(".view-content");
    if (!(viewContent instanceof HTMLElement)) {
      return;
    }
    const existingButtons = viewContent.querySelectorAll(".neurovox-button-container");
    existingButtons.forEach((el) => {
      if (el !== this.containerEl) {
        el.remove();
      }
    });
    if (!this.containerEl) {
      if (this.desktopPill) {
        this.containerEl = this.desktopPill.getContainerEl();
        this.buttonEl = this.desktopPill.getButtonEl();
      } else {
        this.createContainer();
        this.createButton();
      }
    }
    if (this.containerEl && this.containerEl.parentNode !== viewContent) {
      if (this.containerEl.parentNode) {
        this.containerEl.remove();
      }
      viewContent.appendChild(this.containerEl);
    }
    this.activeLeafContainer = viewContent;
    if (this.desktopPill) {
      this.desktopPill.setActiveContainer(viewContent);
    }
    this.registerPageDropEvents();
    this.initializePositionManager();
    if (this.plugin.settings.showFloatingButton) {
      this.show();
    } else {
      this.hide();
    }
  }
  registerPageDropEvents() {
    if (!this.activeLeafContainer)
      return;
    if (this.onPageDragOverBound) {
      this.activeLeafContainer.removeEventListener("dragover", this.onPageDragOverBound);
    }
    if (this.onPageDropBound) {
      this.activeLeafContainer.removeEventListener("drop", this.onPageDropBound);
    }
    this.onPageDragOverBound = (event: any) => {
      var _a;
      if (!this.hasAudioFile(event.dataTransfer))
        return;
      event.preventDefault();
      (_a = this.activeLeafContainer) == null ? void 0 : _a.addClass("neurovox-drop-target-active");
    };
    this.onPageDropBound = (event: any) => {
      var _a;
      if (!this.hasAudioFile(event.dataTransfer))
        return;
      event.preventDefault();
      (_a = this.activeLeafContainer) == null ? void 0 : _a.removeClass("neurovox-drop-target-active");
      void this.handleDroppedAudio(event.dataTransfer, "page");
    };
    this.activeLeafContainer.addEventListener("dragover", this.onPageDragOverBound);
    this.activeLeafContainer.addEventListener("drop", this.onPageDropBound);
    this.activeLeafContainer.addEventListener("dragleave", () => {
      var _a;
      (_a = this.activeLeafContainer) == null ? void 0 : _a.removeClass("neurovox-drop-target-active");
    });
  }
  /**
   * Handles updating the active container when switching notes
   */
  updateActiveContainer(newContainer: any) {
    var _a, _b;
    if (this.activeLeafContainer) {
      (_a = this.resizeObserver) == null ? void 0 : _a.unobserve(this.activeLeafContainer);
    }
    this.activeLeafContainer = newContainer;
    if (this.containerEl) {
      newContainer.appendChild(this.containerEl);
    }
    if (this.desktopPill) {
      this.desktopPill.setActiveContainer(newContainer);
    }
    (_b = this.resizeObserver) == null ? void 0 : _b.observe(newContainer);
    this.initializePositionManager();
    if (this.plugin.settings.showFloatingButton) {
      this.show();
    } else {
      this.hide();
    }
  }
  updateButtonColor() {
    if (!this.buttonEl)
      return;
    const color = this.pluginData.micButtonColor;
    this.buttonEl.style.setProperty("--neurovox-button-color", color);
    if (this.desktopPill) {
      this.desktopPill.updateButtonColor(color);
    }
  }
  getCurrentPosition() {
    if (this.isMobileDevice && this.buttonEl && this.activeLeafContainer) {
      const buttonRect = this.buttonEl.getBoundingClientRect();
      const parentRect = this.activeLeafContainer.getBoundingClientRect();
      return {
        x: Math.round(buttonRect.left - parentRect.left + buttonRect.width / 2),
        y: Math.round(buttonRect.top - parentRect.top + buttonRect.height / 2)
      };
    }
    if (!this.positionManager) {
      return this.pluginData.buttonPosition || { x: 100, y: 100 };
    }
    return this.positionManager.getCurrentPosition();
  }
  show() {
    if (this.isMobileDevice && this.mobilePill) {
      this.mobilePill.show();
      return;
    }
    if (!this.containerEl)
      return;
    this.containerEl.style.display = "block";
    requestAnimationFrame(() => {
      if (this.containerEl) {
        this.containerEl.style.opacity = "1";
        if (this.positionManager) {
          this.positionManager.constrainPosition();
        }
      }
    });
  }
  hide() {
    if (this.isMobileDevice && this.mobilePill) {
      this.mobilePill.hide();
      return;
    }
    if (!this.containerEl)
      return;
    this.containerEl.style.display = "none";
    this.containerEl.style.opacity = "0";
  }
  remove() {
    var _a;
    this.isDisposed = true;
    if (this.activeLeafRef) {
      this.plugin.app.workspace.offref(this.activeLeafRef);
      this.activeLeafRef = null;
    }
    if (this.layoutChangeRef) {
      this.plugin.app.workspace.offref(this.layoutChangeRef);
      this.layoutChangeRef = null;
    }
    if (this.resizeRef) {
      this.plugin.app.workspace.offref(this.resizeRef);
      this.resizeRef = null;
    }
    if (this.mobilePill) {
      this.mobilePill.dispose();
      this.mobilePill = null;
    }
    if (this.desktopPill) {
      this.desktopPill.dispose();
      this.desktopPill = null;
      this.containerEl = null;
      this.buttonEl = null;
    }
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }
    if (this.positionManager) {
      this.positionManager.cleanup();
      this.positionManager = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.cleanup();
    (_a = this.inlineRecorderPanel) == null ? void 0 : _a.dispose();
    this.inlineRecorderPanel = null;
    if (this.activeLeafContainer) {
      if (this.onPageDragOverBound) {
        this.activeLeafContainer.removeEventListener("dragover", this.onPageDragOverBound);
      }
      if (this.onPageDropBound) {
        this.activeLeafContainer.removeEventListener("drop", this.onPageDropBound);
      }
      this.activeLeafContainer.removeClass("neurovox-drop-target-active");
    }
    if (this.buttonEl) {
      if (this.onMicDragOverBound) {
        this.buttonEl.removeEventListener("dragover", this.onMicDragOverBound);
      }
      if (this.onMicDropBound) {
        this.buttonEl.removeEventListener("drop", this.onMicDropBound);
      }
      this.buttonEl.remove();
      this.buttonEl = null;
    }
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
    if (FloatingButton.instance === this) {
      FloatingButton.instance = null;
    }
  }
  /**
   * Handles click based on current recording mode
   */
  async handleClick() {
    if (this.isMobileDevice) {
      await this.ensureMobileLiveDefaults();
      if (this.mobilePill) {
        this.mobilePill.handlePillTap();
        return;
      }
      await this.toggleInlineRecorderPanel();
      return;
    }
    if (this.desktopPill) {
      this.desktopPill.handlePillTap();
      return;
    }
    if (this.pluginData.useRecordingModal && this.plugin.settings.useExpandableFloatingRecorder) {
      await this.toggleInlineRecorderPanel();
      return;
    }
    if (this.isProcessing)
      return;
    if (this.pluginData.useRecordingModal) {
      this.onClickCallback();
      return;
    }
    if (!this.isRecording) {
      await this.startDirectRecording();
    } else {
      await this.stopDirectRecording();
    }
  }
  /**
   * Starts direct recording mode
   */
  async startDirectRecording() {
    try {
      if (!this.audioManager) {
        this.audioManager = new AudioRecordingManager(this.plugin);
        await this.audioManager.initialize();
      }
      this.audioManager.start();
      this.isRecording = true;
      this.updateRecordingState(true);
      new Notice("Recording started");
    } catch (error) {
      new Notice("Failed to start recording");
      this.cleanup();
    }
  }
  async stopDirectRecording() {
    try {
      if (!this.audioManager) {
        throw new Error("Audio manager not initialized");
      }
      this.isRecording = false;
      this.updateRecordingState(false);
      const blob = await this.audioManager.stop();
      if (!blob)
        return;
      this.isProcessing = true;
      this.updateProcessingState(true);
      const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView || !activeView.file) {
        new Notice("No active file to insert recording");
        return;
      }
      await this.plugin.recordingProcessor.processRecording(
        blob,
        activeView.file,
        activeView.editor.getCursor()
      );
    } catch (error) {
      new Notice("Failed to stop recording");
    } finally {
      this.cleanup();
    }
  }
  /**
   * Updates the visual state for recording
   */
  updateRecordingState(isRecording: any) {
    if (!this.buttonEl)
      return;
    if (isRecording) {
      this.buttonEl.addClass("recording");
    } else {
      this.buttonEl.removeClass("recording");
    }
    this.buttonEl.setAttribute(
      "aria-label",
      isRecording ? "Stop recording" : "Start recording"
    );
  }
  updateProcessingState(isProcessing: any) {
    if (!this.buttonEl)
      return;
    this.buttonEl.toggleClass("processing", isProcessing);
  }
  cleanup() {
    this.isRecording = false;
    this.isProcessing = false;
    this.updateRecordingState(false);
    this.updateProcessingState(false);
    if (this.audioManager) {
      this.audioManager.cleanup();
      this.audioManager = null;
    }
  }
  hasAudioFile(dataTransfer: any) {
    var _a;
    if (!((_a = dataTransfer == null ? void 0 : dataTransfer.files) == null ? void 0 : _a.length))
      return false;
    const valid = ["mp3", "wav", "webm", "m4a", "ogg", "mp4"];
    return Array.from(dataTransfer.files).some((file: any) => {
      var _a2;
      const ext = ((_a2 = file.name.split(".").pop()) == null ? void 0 : _a2.toLowerCase()) || "";
      return valid.includes(ext) || file.type.startsWith("audio/");
    });
  }
  async handleDroppedAudio(dataTransfer: any, source: any) {
    var _a, _b;
    const file = (_a = dataTransfer == null ? void 0 : dataTransfer.files) == null ? void 0 : _a[0];
    if (!file)
      return;
    const ext = ((_b = file.name.split(".").pop()) == null ? void 0 : _b.toLowerCase()) || "";
    const valid = ["mp3", "wav", "webm", "m4a", "ogg", "mp4"];
    if (!valid.includes(ext) && !file.type.startsWith("audio/")) {
      new Notice("Dropped file is not a supported audio format.");
      return;
    }
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!(activeView == null ? void 0 : activeView.file)) {
      new Notice("Open a note first to insert dropped audio transcription.");
      return;
    }
    const confirmed = await this.openDropReviewModal(file, activeView.file, source);
    if (!confirmed)
      return;
    try {
      this.isProcessing = true;
      this.updateProcessingState(true);
      const blob = new Blob([await file.arrayBuffer()], {
        type: file.type || "audio/wav"
      });
      await this.plugin.recordingProcessor.processRecording(
        blob,
        activeView.file,
        activeView.editor.getCursor(),
        file.name
      );
      new Notice(`Transcribed dropped audio: ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to transcribe dropped audio: ${message}`);
    } finally {
      this.isProcessing = false;
      this.updateProcessingState(false);
    }
  }
  async openDropReviewModal(file: any, targetFile: any, source: any) {
    return new Promise((resolve) => {
      const modal = new DropReviewModal(this.plugin, file, targetFile, source, (ok: any) => {
        resolve(ok);
      });
      modal.open();
    });
  }
  async toggleInlineRecorderPanel() {
    if (this.isMobileDevice && this.mobilePill) {
      return;
    }
    if (this.inlineRecorderPanel) {
      this.inlineRecorderPanel.toggleCollapsed();
      return;
    }
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.file) {
      new Notice("No active note found to insert transcription.");
      return;
    }
    if (!this.activeLeafContainer) {
      new Notice("Recorder panel unavailable in this view.");
      return;
    }
    const anchor = this.getCurrentPosition();
    const cursorPosition = activeView.editor.getCursor();
    this.inlineRecorderPanel = new InlineRecorderPanel({
      plugin: this.plugin,
      containerEl: this.activeLeafContainer,
      anchor,
      isMobileSheet: this.isMobileDevice,
      activeFile: activeView.file,
      cursorPosition,
      onDispose: () => {
        this.inlineRecorderPanel = null;
        this.updateRecordingState(false);
        this.isRecording = false;
        this.isProcessing = false;
        this.updateProcessingState(false);
      },
      onStateChange: (state: any) => {
        this.isRecording = state === "recording" || state === "paused" || state === "finalizing";
        this.updateRecordingState(this.isRecording);
      }
    });
    await this.inlineRecorderPanel.start();
  }
  async ensureMobileLiveDefaults() {
    if (!this.isMobileDevice || this.mobileDefaultsEnsured)
      return;
    this.mobileDefaultsEnsured = true;
    const shouldEnableDiarization = !this.plugin.settings.enableSpeakerDiarization;
    const shouldEnableTimestamps = !this.plugin.settings.includeTimestamps;
    if (!shouldEnableDiarization && !shouldEnableTimestamps)
      return;
    this.plugin.settings.enableSpeakerDiarization = true;
    this.plugin.settings.includeTimestamps = true;
    try {
      await this.plugin.saveSettings({ refreshUi: false, triggerFloatingRefresh: false });
      new Notice("Enabled mobile speaker-turn timestamps by default.");
    } catch (e) {
    }
  }
}
class DropReviewModal extends Modal {
  file: any;
  targetFile: any;
  source: any;
  onResolve: any;
  resolved: any;
  constructor(appPlugin: any, file: any, targetFile: any, source: any, onResolve: any) {
    super(appPlugin.app);
    this.file = file;
    this.targetFile = targetFile;
    this.source = source;
    this.onResolve = onResolve;
    this.resolved = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Review dropped audio" });
    contentEl.createEl("p", {
      text: `Source: ${this.source === "mic" ? "Floating mic" : "Editor page"}`
    });
    contentEl.createEl("p", { text: `File: ${this.file.name}` });
    contentEl.createEl("p", {
      text: `Size: ${(this.file.size / (1024 * 1024)).toFixed(2)} MB`
    });
    contentEl.createEl("p", { text: `Target note: ${this.targetFile.path}` });
    const actions = contentEl.createDiv({ cls: "neurovox-drop-review-actions" });
    const startBtn = actions.createEl("button", { text: "Start transcription" });
    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    startBtn.addEventListener("click", () => {
      this.resolved = true;
      this.onResolve(true);
      this.close();
    });
    cancelBtn.addEventListener("click", () => {
      this.resolved = true;
      this.onResolve(false);
      this.close();
    });
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onResolve(false);
    }
  }
}
