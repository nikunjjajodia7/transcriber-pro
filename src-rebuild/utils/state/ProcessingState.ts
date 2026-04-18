export class ProcessingState {
  constructor() {
    this.isProcessing = false;
    this.currentStep = null;
    this.steps = [];
    this.startTime = Date.now();
  }
  /**
   * Records the start of a processing step
   */
  startStep(name) {
    this.currentStep = { name, startTime: performance.now() };
    this.steps.push(this.currentStep);
  }
  /**
   * Records the completion of the current step
   */
  completeStep() {
    if (this.currentStep) {
      this.currentStep.endTime = performance.now();
    }
  }
  /**
   * Returns timings for all completed steps
   */
  getTimings() {
    return Object.fromEntries(
      this.steps.filter((step) => step.endTime).map((step) => [
        step.name,
        step.endTime - step.startTime
      ])
    );
  }
  /**
   * Updates chunk processing progress
   */
  updateProgress(processed, total) {
    this.processedChunks = processed;
    this.totalChunks = total;
  }
  /**
   * Records an error that occurred during processing
   */
  setError(error) {
    this.error = error instanceof Error ? error.message : error;
  }
  /**
   * Gets the current processing progress
   */
  getProgress() {
    return {
      processed: this.processedChunks,
      total: this.totalChunks
    };
  }
  /**
   * Gets whether processing is currently active
   */
  getIsProcessing() {
    return this.isProcessing;
  }
  /**
   * Sets the processing state
   */
  setIsProcessing(value) {
    this.isProcessing = value;
  }
  /**
   * Gets the current error if any
   */
  getError() {
    return this.error;
  }
  /**
   * Gets how long processing has been running
   */
  getDuration() {
    return Date.now() - this.startTime;
  }
  /**
   * Gets the name of the current processing step
   */
  getCurrentStepName() {
    var _a;
    return ((_a = this.currentStep) == null ? void 0 : _a.name) || null;
  }
  /**
   * Resets the state to initial values
   */
  reset() {
    this.isProcessing = false;
    this.currentStep = null;
    this.audioBlob = void 0;
    this.transcription = void 0;
    this.postProcessing = void 0;
    this.startTime = Date.now();
    this.error = void 0;
    this.processedChunks = void 0;
    this.totalChunks = void 0;
    this.steps = [];
  }
  /**
   * Converts the state to a JSON-compatible object for storage
   */
  toJSON() {
    return {
      isProcessing: this.isProcessing,
      currentStep: this.currentStep,
      transcription: this.transcription,
      postProcessing: this.postProcessing,
      startTime: this.startTime,
      error: this.error,
      processedChunks: this.processedChunks,
      totalChunks: this.totalChunks
    };
  }
  /**
   * Restores state from a saved JSON object
   */
  fromJSON(data) {
    var _a, _b, _c;
    this.isProcessing = (_a = data.isProcessing) != null ? _a : false;
    this.currentStep = (_b = data.currentStep) != null ? _b : null;
    this.transcription = data.transcription;
    this.postProcessing = data.postProcessing;
    this.startTime = (_c = data.startTime) != null ? _c : Date.now();
    this.error = data.error;
    this.processedChunks = data.processedChunks;
    this.totalChunks = data.totalChunks;
  }
}
