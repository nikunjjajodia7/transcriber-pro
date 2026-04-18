var UploadBottomSheet = class {
  constructor(options) {
    this.plugin = options.plugin;
    this.saveAudioOn = options.saveAudioOn;
    this.onTranscribe = options.onTranscribe;
    this.onCancel = options.onCancel;
    this.selectedFile = null;
    this.overlayEl = null;
    this.sheetEl = null;
    this.fileCardEl = null;
    this.fileNameEl = null;
    this.fileSizeEl = null;
    this.ctaEl = null;
    this.saveToggleEl = null;
    this.fileInputEl = null;
    this.chooseLinkEl = null;
  }
  open() {
    // Overlay
    this.overlayEl = document.createElement("div");
    this.overlayEl.classList.add("neurovox-upload-overlay");
    this.overlayEl.addEventListener("click", () => this.close());
    document.body.appendChild(this.overlayEl);
    // Sheet
    this.sheetEl = document.createElement("div");
    this.sheetEl.classList.add("neurovox-upload-sheet");
    // Handle bar
    const handle = document.createElement("div");
    handle.classList.add("neurovox-upload-sheet__handle");
    this.sheetEl.appendChild(handle);
    // Header (centered title + description)
    const header = document.createElement("div");
    header.classList.add("neurovox-upload-sheet__header");
    const title = document.createElement("span");
    title.classList.add("neurovox-upload-sheet__title");
    title.textContent = "Upload Audio";
    header.appendChild(title);
    const description = document.createElement("div");
    description.classList.add("neurovox-upload-sheet__description");
    description.textContent = "Select an audio file to transcribe into your note.";
    header.appendChild(description);
    this.sheetEl.appendChild(header);
    // File picker area
    const picker = document.createElement("div");
    picker.classList.add("neurovox-upload-sheet__picker");
    const pickerIcon = document.createElement("div");
    pickerIcon.classList.add("neurovox-upload-sheet__picker-icon");
    (0, import_obsidian16.setIcon)(pickerIcon, "upload");
    picker.appendChild(pickerIcon);
    const pickerText = document.createElement("div");
    pickerText.classList.add("neurovox-upload-sheet__picker-text");
    pickerText.textContent = "Tap to select an audio file";
    picker.appendChild(pickerText);
    picker.addEventListener("click", () => this.openFilePicker());
    this.sheetEl.appendChild(picker);
    // File card (hidden initially)
    this.fileCardEl = document.createElement("div");
    this.fileCardEl.classList.add("neurovox-upload-sheet__file-card");
    const fileIcon = document.createElement("div");
    fileIcon.classList.add("neurovox-upload-sheet__file-icon");
    (0, import_obsidian16.setIcon)(fileIcon, "music");
    this.fileCardEl.appendChild(fileIcon);
    const fileInfo = document.createElement("div");
    fileInfo.classList.add("neurovox-upload-sheet__file-info");
    this.fileNameEl = document.createElement("div");
    this.fileNameEl.classList.add("neurovox-upload-sheet__file-name");
    fileInfo.appendChild(this.fileNameEl);
    this.fileSizeEl = document.createElement("div");
    this.fileSizeEl.classList.add("neurovox-upload-sheet__file-size");
    fileInfo.appendChild(this.fileSizeEl);
    this.fileCardEl.appendChild(fileInfo);
    const fileCheck = document.createElement("div");
    fileCheck.classList.add("neurovox-upload-sheet__file-check");
    (0, import_obsidian16.setIcon)(fileCheck, "check-circle");
    this.fileCardEl.appendChild(fileCheck);
    this.sheetEl.appendChild(this.fileCardEl);
    // "Choose a different file" link
    this.chooseLinkEl = document.createElement("button");
    this.chooseLinkEl.classList.add("neurovox-upload-sheet__choose-link");
    this.chooseLinkEl.textContent = "Choose a different file";
    this.chooseLinkEl.style.display = "none";
    this.chooseLinkEl.addEventListener("click", () => this.openFilePicker());
    this.sheetEl.appendChild(this.chooseLinkEl);
    // Save audio toggle row
    const saveRow = document.createElement("div");
    saveRow.classList.add("neurovox-upload-sheet__save-row");
    const saveRowLeft = document.createElement("div");
    saveRowLeft.classList.add("neurovox-upload-sheet__save-row-left");
    const saveIcon = document.createElement("div");
    saveIcon.classList.add("neurovox-upload-sheet__save-icon");
    (0, import_obsidian16.setIcon)(saveIcon, "save");
    saveRowLeft.appendChild(saveIcon);
    const saveLabel = document.createElement("span");
    saveLabel.classList.add("neurovox-upload-sheet__save-label");
    saveLabel.textContent = "Save audio to vault";
    saveRowLeft.appendChild(saveLabel);
    saveRow.appendChild(saveRowLeft);
    this.saveToggleEl = document.createElement("button");
    this.saveToggleEl.classList.add("neurovox-upload-sheet__save-toggle");
    if (this.saveAudioOn) this.saveToggleEl.classList.add("active");
    this.saveToggleEl.addEventListener("click", () => {
      this.saveAudioOn = !this.saveAudioOn;
      this.saveToggleEl.classList.toggle("active", this.saveAudioOn);
    });
    saveRow.appendChild(this.saveToggleEl);
    this.sheetEl.appendChild(saveRow);
    // Transcribe CTA with sparkles icon
    this.ctaEl = document.createElement("button");
    this.ctaEl.classList.add("neurovox-upload-sheet__cta");
    const sparklesIcon = document.createElement("span");
    (0, import_obsidian16.setIcon)(sparklesIcon, "sparkles");
    this.ctaEl.appendChild(sparklesIcon);
    const ctaText = document.createElement("span");
    ctaText.textContent = "Transcribe";
    this.ctaEl.appendChild(ctaText);
    this.ctaEl.addEventListener("click", () => {
      if (!this.selectedFile) return;
      const file = this.selectedFile;
      const save = this.saveAudioOn;
      this.close();
      this.onTranscribe(file, save);
    });
    this.sheetEl.appendChild(this.ctaEl);
    document.body.appendChild(this.sheetEl);
    // Hidden file input
    this.fileInputEl = document.createElement("input");
    this.fileInputEl.type = "file";
    this.fileInputEl.accept = ".mp3,.wav,.webm,.m4a,.ogg,.mp4,audio/*";
    this.fileInputEl.style.display = "none";
    this.fileInputEl.addEventListener("change", () => {
      var _a;
      const file = (_a = this.fileInputEl.files) == null ? void 0 : _a[0];
      if (file) this.setFile(file);
    });
    document.body.appendChild(this.fileInputEl);
    // Keyboard and back-button dismiss
    this.onEscBound = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    };
    this.onPopStateBound = () => {
      this.close();
    };
    document.addEventListener("keydown", this.onEscBound);
    window.addEventListener("popstate", this.onPopStateBound);
    // Animate in
    requestAnimationFrame(() => {
      if (this.overlayEl) this.overlayEl.classList.add("visible");
      if (this.sheetEl) this.sheetEl.classList.add("visible");
    });
  }
  openFilePicker() {
    if (this.fileInputEl) this.fileInputEl.click();
  }
  setFile(file) {
    this.selectedFile = file;
    if (this.fileNameEl) this.fileNameEl.textContent = file.name;
    if (this.fileSizeEl) this.fileSizeEl.textContent = this.formatSize(file.size);
    if (this.fileCardEl) this.fileCardEl.classList.add("has-file");
    if (this.ctaEl) this.ctaEl.classList.add("enabled");
    if (this.chooseLinkEl) this.chooseLinkEl.style.display = "";
  }
  clearFile() {
    this.selectedFile = null;
    if (this.fileCardEl) this.fileCardEl.classList.remove("has-file");
    if (this.ctaEl) this.ctaEl.classList.remove("enabled");
    if (this.fileInputEl) this.fileInputEl.value = "";
    if (this.chooseLinkEl) this.chooseLinkEl.style.display = "none";
  }
  formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  close() {
    if (this.onEscBound) {
      document.removeEventListener("keydown", this.onEscBound);
      this.onEscBound = null;
    }
    if (this.onPopStateBound) {
      window.removeEventListener("popstate", this.onPopStateBound);
      this.onPopStateBound = null;
    }
    if (this.overlayEl) {
      this.overlayEl.classList.remove("visible");
    }
    if (this.sheetEl) {
      this.sheetEl.classList.remove("visible");
    }
    setTimeout(() => {
      if (this.overlayEl) { this.overlayEl.remove(); this.overlayEl = null; }
      if (this.sheetEl) { this.sheetEl.remove(); this.sheetEl = null; }
      if (this.fileInputEl) { this.fileInputEl.remove(); this.fileInputEl = null; }
      this.onCancel();
    }, 320);
  }
};
