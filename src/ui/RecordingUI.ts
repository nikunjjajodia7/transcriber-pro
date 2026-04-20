import { setIcon } from 'obsidian';
import { TouchableButton } from './TouchableButton';

export class RecordingUI {
  container: any;
  handlers: any;
  currentState: any;
  timerText: any;
  pauseButton: any;
  stopButton: any;
  waveContainer: any;
  onUnloadBound: any = null;
  isDisposed: any = false;
  constructor(container: any, handlers: any) {
    this.container = container;
    this.handlers = handlers;
    this.currentState = "inactive";
    this.initializeComponents();
    this.onUnloadBound = () => this.cleanup();
    window.addEventListener("unload", this.onUnloadBound);
  }
  initializeComponents() {
    this.setupTouchHandlers();
    this.createTimerDisplay();
    this.createControls();
    this.createWaveform();
  }
  /**
   * Sets up touch event handlers for mobile interactions
   * 📱 Prevents unwanted gestures and ensures smooth interaction
   */
  setupTouchHandlers() {
    this.container.addEventListener("gesturestart", (e: any) => {
      e.preventDefault();
    }, { passive: false });
    this.container.addEventListener("touchmove", (e: any) => {
      e.preventDefault();
    }, { passive: false });
    let lastTap = 0;
    this.container.addEventListener("touchend", (e: any) => {
      const currentTime = new Date().getTime();
      const tapLength = currentTime - lastTap;
      if (tapLength < 300 && tapLength > 0) {
        e.preventDefault();
      }
      lastTap = currentTime;
    }, { passive: false });
  }
  createTimerDisplay() {
    this.timerText = this.container.createDiv({
      cls: "neurovox-timer-display",
      text: "00:00"
    });
  }
  createControls() {
    const controls = this.container.createDiv({
      cls: "neurovox-timer-controls"
    });
    this.pauseButton = new TouchableButton({
      container: controls,
      text: "",
      icon: "pause",
      classes: ["neurovox-timer-button", "neurovox-pause-button"],
      ariaLabel: "Pause recording",
      onClick: () => this.handlers.onPause()
    });
    this.stopButton = new TouchableButton({
      container: controls,
      text: "",
      icon: "square",
      classes: ["neurovox-timer-button", "neurovox-stop-button"],
      ariaLabel: "Stop Recording",
      onClick: () => this.handlers.onStop()
    });
  }
  createWaveform() {
    this.waveContainer = this.container.createDiv({
      cls: "neurovox-audio-wave"
    });
    for (let i = 0; i < 5; i++) {
      this.waveContainer.createDiv({
        cls: "neurovox-wave-bar"
      });
    }
  }
  updateTimer(seconds: any, maxDuration: any, warningThreshold: any) {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
    const remainingSeconds = (seconds % 60).toString().padStart(2, "0");
    this.timerText.setText(`${minutes}:${remainingSeconds}`);
    const hasFiniteLimit = Number.isFinite(maxDuration) && maxDuration > 0;
    if (!hasFiniteLimit) {
      this.timerText.removeClass("is-warning");
      return;
    }
    const timeLeft = maxDuration - seconds;
    this.timerText.toggleClass("is-warning", timeLeft <= warningThreshold);
  }
  updateState(state: any) {
    this.currentState = state;
    const states = ["is-recording", "is-paused", "is-stopped", "is-inactive"];
    states.forEach((cls) => this.waveContainer.removeClass(cls));
    this.waveContainer.addClass(`is-${state}`);
    const isPaused = state === "paused";
    const iconName = isPaused ? "play" : "pause";
    const label = isPaused ? "Resume recording" : "Pause Recording";
    this.pauseButton.buttonEl.empty();
    setIcon(this.pauseButton.buttonEl, iconName);
    this.pauseButton.buttonEl.setAttribute("aria-label", label);
    this.pauseButton.buttonEl.toggleClass("is-paused", isPaused);
  }
  /**
   * Enhanced cleanup with proper resource management
   * 🧹 Ensures all resources are properly released
   */
  cleanup() {
    if (this.isDisposed) return;
    if (this.onUnloadBound) {
      window.removeEventListener("unload", this.onUnloadBound);
      this.onUnloadBound = null;
    }
    var _a, _b;
    (_a = this.pauseButton) == null ? void 0 : _a.cleanup();
    (_b = this.stopButton) == null ? void 0 : _b.cleanup();
    this.container.empty();
    this.isDisposed = true;
  }
}
