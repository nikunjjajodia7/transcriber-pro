import { ButtonComponent, setIcon } from 'obsidian';

export class TouchableButton extends ButtonComponent {
  isProcessingAction: any;
  DEBOUNCE_TIME: any;
  actionTimeout: any;
  longPressTimerId: any = null;
  errorRecoveryTimerId: any = null;
  isDisposed: any = false;
  constructor(options: any) {
    super(options.container);
    this.isProcessingAction = false;
    this.DEBOUNCE_TIME = 1e3;
    this.actionTimeout = null;
    this.setupButton(options);
  }
  setupButton(options: any) {
    this.setButtonText(options.text);
    if (options.icon) {
      setIcon(this.buttonEl, options.icon);
    }
    if (options.classes) {
      options.classes.forEach((cls: any) => this.buttonEl.addClass(cls));
    }
    if (options.ariaLabel) {
      this.buttonEl.setAttribute("aria-label", options.ariaLabel);
    }
    if (options.isCta) {
      this.setCta();
    }
    this.buttonEl.addClass("touch-button");
    this.buttonEl.setAttribute("data-state", "ready");
    this.buttonEl.setAttribute("role", "button");
    this.buttonEl.setAttribute("tabindex", "0");
    this.setupTouchHandlers(options.onClick);
  }
  setupTouchHandlers(onClick: any) {
    let touchStartTime = 0;
    let isLongPress = false;
    const handleTouchStart = (e: any) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.isProcessingAction)
        return;
      touchStartTime = Date.now();
      isLongPress = false;
      this.buttonEl.addClass("is-touching");
      this.longPressTimerId = setTimeout(() => {
        if (this.isDisposed) return;
        if (this.buttonEl.matches(":active")) {
          isLongPress = true;
          this.buttonEl.addClass("is-long-press");
        }
        this.longPressTimerId = null;
      }, 500);
    };
    const handleTouchEnd = async (e: any) => {
      e.preventDefault();
      e.stopPropagation();
      this.buttonEl.removeClass("is-touching");
      this.buttonEl.removeClass("is-long-press");
      if (this.isProcessingAction || isLongPress)
        return;
      const touchDuration = Date.now() - touchStartTime;
      if (touchDuration > 1e3)
        return;
      await this.processButtonAction(onClick);
    };
    const handleTouchCancel = () => {
      this.buttonEl.removeClass("is-touching");
      this.buttonEl.removeClass("is-long-press");
    };
    this.buttonEl.addEventListener("touchstart", handleTouchStart, { passive: false });
    this.buttonEl.addEventListener("touchend", handleTouchEnd, { passive: false });
    this.buttonEl.addEventListener("touchcancel", handleTouchCancel);
    this.onClick(async (e) => {
      e.preventDefault();
      if (!this.isProcessingAction) {
        await this.processButtonAction(onClick);
      }
    });
  }
  /**
   * Processes button actions with proper state management and feedback
   * 🎯 Handles action processing with proper cleanup
   */
  async processButtonAction(onClick: any) {
    if (this.isProcessingAction)
      return;
    this.buttonEl.setAttribute("data-state", "processing");
    this.buttonEl.addClass("is-processing");
    this.isProcessingAction = true;
    try {
      if (this.actionTimeout) {
        clearTimeout(this.actionTimeout);
      }
      await onClick();
      this.actionTimeout = setTimeout(() => {
        this.isProcessingAction = false;
        this.buttonEl.setAttribute("data-state", "ready");
        this.buttonEl.removeClass("is-processing");
      }, this.DEBOUNCE_TIME);
    } catch (error) {
      this.isProcessingAction = false;
      this.buttonEl.setAttribute("data-state", "error");
      this.buttonEl.addClass("has-error");
      this.errorRecoveryTimerId = setTimeout(() => {
        if (this.isDisposed) return;
        this.buttonEl.setAttribute("data-state", "ready");
        this.buttonEl.removeClass("has-error");
        this.errorRecoveryTimerId = null;
      }, 2e3);
    }
  }
  /**
   * Cleanup resources and event listeners
   */
  cleanup() {
    if (this.actionTimeout) {
      clearTimeout(this.actionTimeout);
      this.actionTimeout = null;
    }
    if (this.longPressTimerId) {
      clearTimeout(this.longPressTimerId);
      this.longPressTimerId = null;
    }
    if (this.errorRecoveryTimerId) {
      clearTimeout(this.errorRecoveryTimerId);
      this.errorRecoveryTimerId = null;
    }
    this.buttonEl.remove();
    this.isDisposed = true;
  }
}
