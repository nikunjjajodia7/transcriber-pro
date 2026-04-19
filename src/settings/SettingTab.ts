import { PluginSettingTab } from 'obsidian';
import { ModelHookupAccordion } from './accordions/ModelHookupAccordion';
import { PostProcessingAccordion } from './accordions/PostProcessingAccordion';
import { RecordingAccordion } from './accordions/RecordingAccordion';

export class NeuroVoxSettingTab extends PluginSettingTab {
  recordingAccordion: any;
  postProcessingAccordion: any;
  plugin: any;
  constructor(app: any, plugin: any) {
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
      (provider: any) => this.plugin.aiAdapters.get(provider),
      this.plugin
    );
    this.postProcessingAccordion = new PostProcessingAccordion(
      postProcessingContainer,
      this.plugin.settings,
      (provider: any) => this.plugin.aiAdapters.get(provider),
      this.plugin
    );
    const modelHookupAccordion = new ModelHookupAccordion(
      modelHookupContainer,
      this.plugin.settings,
      (provider: any) => this.plugin.aiAdapters.get(provider),
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
}
