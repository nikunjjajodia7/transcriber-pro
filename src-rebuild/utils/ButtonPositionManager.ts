var ButtonPositionManager = class {
  constructor(containerEl, buttonEl, activeContainer, buttonSize, margin, onPositionChange, onDragEnd, onClick) {
    this.containerEl = containerEl;
    this.buttonEl = buttonEl;
    this.activeContainer = activeContainer;
    this.buttonSize = buttonSize;
    this.margin = margin;
    this.onPositionChange = onPositionChange;
    this.onDragEnd = onDragEnd;
    this.onClick = onClick;
    this.isDragging = false;
    this.hasMoved = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.lastContainerWidth = null;
    this.relativeX = 0;
    this.relativeY = 0;
    this.DRAG_THRESHOLD = 5;
    this.handleDragStart = (e) => {
      if (e.button !== 0)
        return;
      e.preventDefault();
      e.stopPropagation();
      this.isDragging = true;
      this.hasMoved = false;
      this.dragStartX = e.clientX - this.currentX;
      this.dragStartY = e.clientY - this.currentY;
      this.buttonEl.classList.add("is-dragging");
    };
    /**
     * Handles the end of a drag operation
     */
    this.handleDragEnd = (e) => {
      if (!this.isDragging)
        return;
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      this.isDragging = false;
      this.buttonEl.classList.remove("is-dragging");
      if (this.hasMoved) {
        this.onDragEnd({
          x: this.currentX,
          y: this.currentY
        });
      }
      setTimeout(() => {
        this.hasMoved = false;
      }, 100);
    };
    /**
     * Handles drag movement and determines if threshold is met
     */
    this.handleDragMove = (e) => {
      if (!this.isDragging)
        return;
      e.preventDefault();
      e.stopPropagation();
      const newX = e.clientX - this.dragStartX;
      const newY = e.clientY - this.dragStartY;
      if (!this.hasMoved && (Math.abs(newX - this.currentX) > this.DRAG_THRESHOLD || Math.abs(newY - this.currentY) > this.DRAG_THRESHOLD)) {
        this.hasMoved = true;
      }
      this.setPosition(newX, newY);
      this.constrainPosition();
    };
    /**
     * Handles touch events for mobile support
     */
    this.handleTouchStart = (e) => {
      if (e.touches.length !== 1)
        return;
      e.preventDefault();
      const touch = e.touches[0];
      this.isDragging = true;
      this.hasMoved = false;
      this.dragStartX = touch.clientX - this.currentX;
      this.dragStartY = touch.clientY - this.currentY;
      this.buttonEl.classList.add("is-dragging");
    };
    this.handleTouchMove = (e) => {
      if (!this.isDragging || e.touches.length !== 1)
        return;
      e.preventDefault();
      const touch = e.touches[0];
      const newX = touch.clientX - this.dragStartX;
      const newY = touch.clientY - this.dragStartY;
      if (!this.hasMoved && (Math.abs(newX - this.currentX) > this.DRAG_THRESHOLD || Math.abs(newY - this.currentY) > this.DRAG_THRESHOLD)) {
        this.hasMoved = true;
      }
      this.setPosition(newX, newY);
      this.constrainPosition();
    };
    this.handleTouchEnd = () => {
      if (!this.isDragging)
        return;
      const wasDragging = this.hasMoved;
      this.isDragging = false;
      this.buttonEl.classList.remove("is-dragging");
      if (!wasDragging) {
        this.onClick();
      } else {
        this.onDragEnd({
          x: this.currentX,
          y: this.currentY
        });
      }
      this.hasMoved = false;
    };
    this._boundHandlers = {
      move: this.handleDragMove.bind(this),
      end: this.handleDragEnd.bind(this),
      touchMove: this.handleTouchMove.bind(this),
      touchEnd: this.handleTouchEnd.bind(this)
    };
    this.setupEventListeners();
  }
  setPosition(x, y, updateRelative = true) {
    this.currentX = x;
    this.currentY = y;
    if (updateRelative && this.activeContainer) {
      const containerRect = this.activeContainer.getBoundingClientRect();
      this.relativeX = x / containerRect.width;
      this.relativeY = y / containerRect.height;
    }
    this.onPositionChange(x, y);
  }
  constrainPosition() {
    if (!this.activeContainer)
      return;
    const containerRect = this.activeContainer.getBoundingClientRect();
    this.lastContainerWidth = containerRect.width;
    if (containerRect.width < this.buttonSize + this.margin * 2 || containerRect.height < this.buttonSize + this.margin * 2) {
      return;
    }
    const maxX = containerRect.width - this.buttonSize - this.margin;
    const maxY = containerRect.height - this.buttonSize - this.margin;
    const targetX = this.relativeX * containerRect.width;
    const targetY = this.relativeY * containerRect.height;
    const x = Math.max(this.margin, Math.min(targetX, maxX));
    const y = Math.max(this.margin, Math.min(targetY, maxY));
    this.setPosition(x, y, false);
  }
  updateContainer(newContainer) {
    if (!newContainer) {
      this.activeContainer = null;
      return;
    }
    const oldContainer = this.activeContainer;
    this.activeContainer = newContainer;
    if (oldContainer) {
      const newRect = newContainer.getBoundingClientRect();
      const newX = this.relativeX * newRect.width;
      const newY = this.relativeY * newRect.height;
      this.setPosition(newX, newY, false);
    }
    this.constrainPosition();
  }
  setupEventListeners() {
    this.buttonEl.addEventListener("mousedown", this.handleDragStart.bind(this));
    document.addEventListener("mousemove", this._boundHandlers.move);
    document.addEventListener("mouseup", this._boundHandlers.end);
    this.buttonEl.addEventListener("touchstart", this.handleTouchStart.bind(this), { passive: false });
    document.addEventListener("touchmove", this._boundHandlers.touchMove);
    document.addEventListener("touchend", this._boundHandlers.touchEnd);
  }
  getCurrentPosition() {
    return {
      x: this.currentX,
      y: this.currentY
    };
  }
  /**
   * Handles cleanup of position manager resources
   */
  cleanup() {
    this.buttonEl.removeEventListener("mousedown", this.handleDragStart);
    this.buttonEl.removeEventListener("touchstart", this.handleTouchStart);
    document.removeEventListener("mousemove", this._boundHandlers.move);
    document.removeEventListener("mouseup", this._boundHandlers.end);
    document.removeEventListener("touchmove", this._boundHandlers.touchMove);
    document.removeEventListener("touchend", this._boundHandlers.touchEnd);
  }
};
