var import_obsidian19 = require("obsidian");
var RecoveryJobsModal = class extends import_obsidian19.Modal {
  constructor(app, jobs) {
    super(app);
    this.jobs = jobs;
    this.resolvePromise = null;
  }
  async chooseAction() {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("neurovox-recovery-modal");
    contentEl.createEl("h3", { text: "NeuroVox Recovery" });
    contentEl.createEl("p", { text: "Found incomplete transcription jobs. Choose an action:" });
    const controls = contentEl.createDiv({ cls: "neurovox-recovery-controls" });
    const resumeNewest = controls.createEl("button", { text: "Resume Newest" });
    resumeNewest.onclick = () => this.finish({ type: "resume_newest" });
    const cancelAll = controls.createEl("button", { text: "Cancel All" });
    cancelAll.onclick = () => this.finish({ type: "cancel_all" });
    const dismiss = controls.createEl("button", { text: "Dismiss" });
    dismiss.onclick = () => this.finish({ type: "dismiss" });
    const list = contentEl.createDiv({ cls: "neurovox-recovery-list" });
    for (const job of this.jobs) {
      const item = list.createDiv({ cls: "neurovox-recovery-item" });
      const title = item.createDiv({ cls: "neurovox-recovery-title" });
      title.setText(`${job.kind.toUpperCase()} \u2022 ${job.jobId.slice(0, 12)}... \u2022 ${job.status}`);
      const meta = item.createDiv({ cls: "neurovox-recovery-meta" });
      meta.setText(`File: ${job.targetFile} \u2022 Updated: ${new Date(job.updatedAt).toLocaleString()}`);
      if (job.error) {
        const errorEl = item.createDiv({ cls: "neurovox-recovery-error" });
        errorEl.setText(`Error: ${job.error}`);
      }
      const row = item.createDiv({ cls: "neurovox-recovery-row" });
      const resumeBtn = row.createEl("button", { text: "Resume" });
      resumeBtn.onclick = () => this.finish({ type: "resume", jobId: job.jobId });
      const cancelBtn = row.createEl("button", { text: "Cancel" });
      cancelBtn.onclick = () => this.finish({ type: "cancel", jobId: job.jobId });
    }
  }
  onClose() {
    if (this.resolvePromise) {
      const resolve = this.resolvePromise;
      this.resolvePromise = null;
      resolve({ type: "dismiss" });
    }
  }
  finish(action) {
    if (this.resolvePromise) {
      const resolve = this.resolvePromise;
      this.resolvePromise = null;
      resolve(action);
    }
    this.close();
  }
};
