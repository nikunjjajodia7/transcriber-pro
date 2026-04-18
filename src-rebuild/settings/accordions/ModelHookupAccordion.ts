import { Setting } from 'obsidian';
import { BaseAccordion } from './BaseAccordion';

export class ModelHookupAccordion extends BaseAccordion {
  settings: any;
  getAdapter: any;
  plugin: any;
  recordingAccordion: any;
  postProcessingAccordion: any;
  constructor(containerEl: any, settings: any, getAdapter: any, plugin: any) {
    super(
      containerEl,
      "\u{1F511} API Keys",
      "Configure API keys for AI providers."
    );
    this.settings = settings;
    this.getAdapter = getAdapter;
    this.plugin = plugin;
  }
  setAccordions(recording: any, postProcessing: any) {
    this.recordingAccordion = recording;
    this.postProcessingAccordion = postProcessing;
  }
  async refreshAccordions() {
    await Promise.all([
      this.recordingAccordion.refresh(),
      this.postProcessingAccordion.refresh()
    ]);
  }
  render() {
    const openaiSetting = new Setting(this.contentEl).setName("OpenAI API Key").setDesc("Enter your OpenAI API key").addText((text) => {
      text.setPlaceholder("sk-...").setValue(this.settings.openaiApiKey);
      text.inputEl.type = "password";
      text.onChange(async (value) => {
        const trimmedValue = value.trim();
        this.settings.openaiApiKey = trimmedValue;
        await this.plugin.saveSettings();
        const adapter = this.getAdapter("openai" /* OpenAI */);
        if (!adapter) {
          return;
        }
        adapter.setApiKey(trimmedValue);
        const isValid = await adapter.validateApiKey();
        if (isValid) {
          openaiSetting.setDesc("\u2705 API key validated successfully");
          try {
            await this.refreshAccordions();
          } catch (error) {
            openaiSetting.setDesc("\u2705 API key valid, but failed to update model lists");
          }
        } else {
          openaiSetting.setDesc("\u274C Invalid API key. Please check your credentials.");
        }
      });
    });
    const groqSetting = new Setting(this.contentEl).setName("Groq API Key").setDesc("Enter your Groq API key").addText((text) => {
      text.setPlaceholder("gsk_...").setValue(this.settings.groqApiKey);
      text.inputEl.type = "password";
      text.onChange(async (value) => {
        const trimmedValue = value.trim();
        this.settings.groqApiKey = trimmedValue;
        await this.plugin.saveSettings();
        const adapter = this.getAdapter("groq" /* Groq */);
        if (!adapter) {
          return;
        }
        adapter.setApiKey(trimmedValue);
        const isValid = await adapter.validateApiKey();
        if (isValid) {
          groqSetting.setDesc("\u2705 API key validated successfully");
          try {
            await this.refreshAccordions();
          } catch (error) {
            groqSetting.setDesc("\u2705 API key valid, but failed to update model lists");
          }
        } else {
          groqSetting.setDesc("\u274C Invalid API key. Please check your credentials.");
        }
      });
    });
    const deepgramSetting = new Setting(this.contentEl).setName("Deepgram API Key").setDesc("Enter your Deepgram API key").addText((text) => {
      text.setPlaceholder("Enter your Deepgram API key...").setValue(this.settings.deepgramApiKey);
      text.inputEl.type = "password";
      text.onChange(async (value) => {
        const trimmedValue = value.trim();
        this.settings.deepgramApiKey = trimmedValue;
        await this.plugin.saveSettings();
        const adapter = this.getAdapter("deepgram" /* Deepgram */);
        if (!adapter) {
          return;
        }
        adapter.setApiKey(trimmedValue);
        const isValid = await adapter.validateApiKey();
        if (isValid) {
          deepgramSetting.setDesc("\u2705 API key validated successfully");
          try {
            await this.refreshAccordions();
          } catch (error) {
            deepgramSetting.setDesc("\u2705 API key valid, but failed to update model lists");
          }
        } else {
          deepgramSetting.setDesc("\u274C Invalid API key. Please check your credentials.");
        }
      });
    });
  }
}
