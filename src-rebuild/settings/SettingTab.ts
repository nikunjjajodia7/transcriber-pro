var import_obsidian11 = require("obsidian");

var NeuroVoxSettingTab = class extends import_obsidian11.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.recordingAccordion = null;
    this.postProcessingAccordion = null;
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const modelHookupContainer = containerEl.createDiv();
    const recordingContainer = containerEl.createDiv();
    const postProcessingContainer = containerEl.createDiv();
    this.recordingAccordion = new RecordingAccordion(
      recordingContainer,
      this.plugin.settings,
      (provider) => this.plugin.aiAdapters.get(provider),
      this.plugin
    );
    this.postProcessingAccordion = new PostProcessingAccordion(
      postProcessingContainer,
      this.plugin.settings,
      (provider) => this.plugin.aiAdapters.get(provider),
      this.plugin
    );
    const modelHookupAccordion = new ModelHookupAccordion(
      modelHookupContainer,
      this.plugin.settings,
      (provider) => this.plugin.aiAdapters.get(provider),
      this.plugin
    );
    modelHookupAccordion.setAccordions(this.recordingAccordion, this.postProcessingAccordion);
    modelHookupAccordion.render();
    this.recordingAccordion.render();
    this.postProcessingAccordion.render();
  }
  getRecordingAccordion() {
    return this.recordingAccordion;
  }
  getPostProcessingAccordion() {
    return this.postProcessingAccordion;
  }
};
