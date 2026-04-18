import { Setting } from 'obsidian';
import { AIModels, getModelInfo } from '../../adapters/AIAdapter';
import { BaseAccordion } from './BaseAccordion';

export class PostProcessingAccordion extends BaseAccordion {
  constructor(containerEl, settings, getAdapter, plugin) {
    super(
      containerEl,
      "\u{1F4DD} Post-Processing",
      "Configure AI post-processing preferences and customize the prompt template."
    );
    this.settings = settings;
    this.getAdapter = getAdapter;
    this.plugin = plugin;
    this.modelDropdown = null;
    this.modelSetting = null;
    this.promptArea = null;
    this.maxTokensSlider = null;
    this.temperatureSlider = null;
  }
  async refresh() {
    try {
      if (!this.modelDropdown) {
        return;
      }
      await this.setupModelDropdown(this.modelDropdown);
      if (this.settings.postProcessingModel) {
        await this.updateMaxTokensLimit(this.settings.postProcessingModel);
      }
    } catch (error) {
      throw error;
    }
  }
  render() {
    this.addEnableToggle();
    this.addModelSelection();
    this.addPromptTemplate();
    this.addSummaryFormat();
    this.addMaxTokens();
    this.addTemperatureControl();
  }
  addEnableToggle() {
    new Setting(this.contentEl).setName("Enable AI Post-Processing").setDesc("Automatically generate AI post-processing after transcription").addToggle((toggle) => {
      toggle.setValue(this.settings.generatePostProcessing).onChange(async (value) => {
        this.settings.generatePostProcessing = value;
        await this.plugin.saveSettings();
      });
    });
  }
  addModelSelection() {
    if (this.modelSetting) {
      this.modelSetting.settingEl.remove();
    }
    this.modelSetting = new Setting(this.contentEl).setName("Post-processing model").setDesc("Select the AI model for post-processing").addDropdown((dropdown) => {
      this.modelDropdown = dropdown;
      this.setupModelDropdown(dropdown);
      dropdown.onChange(async (value) => {
        this.settings.postProcessingModel = value;
        const provider = this.getProviderFromModel(value);
        if (provider) {
          this.settings.postProcessingProvider = provider;
          await this.plugin.saveSettings();
        }
        await this.updateMaxTokensLimit(value);
      });
    });
  }
  async setupModelDropdown(dropdown) {
    dropdown.selectEl.empty();
    let hasValidProvider = false;
    for (const provider of ["openai" /* OpenAI */, "groq" /* Groq */]) {
      const apiKey = this.settings[`${provider}ApiKey`];
      if (apiKey) {
        const models = AIModels[provider].filter((model) => model.category === "language");
        if (models.length > 0) {
          hasValidProvider = true;
          const group = document.createElement("optgroup");
          group.label = `${provider.toUpperCase()} Models`;
          models.forEach((model) => {
            const option = document.createElement("option");
            option.value = model.id;
            option.text = model.name;
            group.appendChild(option);
          });
          dropdown.selectEl.appendChild(group);
        }
      }
    }
    if (!hasValidProvider) {
      dropdown.addOption("none", "No API keys configured");
      dropdown.setDisabled(true);
      this.settings.postProcessingModel = "";
    } else {
      dropdown.setDisabled(false);
      if (!this.settings.postProcessingModel) {
        const firstOption = dropdown.selectEl.querySelector('option:not([value="none"])');
        if (firstOption) {
          const modelId = firstOption.value;
          const provider = this.getProviderFromModel(modelId);
          if (provider) {
            this.settings.postProcessingProvider = provider;
            this.settings.postProcessingModel = modelId;
            dropdown.setValue(modelId);
          }
        }
      } else {
        dropdown.setValue(this.settings.postProcessingModel);
      }
    }
    await this.plugin.saveSettings();
  }
  addPromptTemplate() {
    new Setting(this.contentEl).setName("Post-processing template").setDesc("Customize the prompt used for generating summaries. Use {transcript} as a placeholder for the transcribed text.").addTextArea((text) => {
      this.promptArea = text;
      text.setPlaceholder("Please process the following transcript: {transcript}").setValue(this.settings.postProcessingPrompt).onChange(async (value) => {
        this.settings.postProcessingPrompt = value;
        await this.plugin.saveSettings();
      });
      text.inputEl.rows = 4;
      text.inputEl.style.width = "100%";
    });
  }
  addSummaryFormat() {
    new Setting(this.contentEl).setName("Post-processing format").setDesc("Customize the post-processing callout format. Use {postProcessing} for the generated content").addTextArea((text) => {
      text.setPlaceholder(">[!note]- Post-Processing\n>{postProcessing}").setValue(this.settings.postProcessingCalloutFormat).onChange(async (value) => {
        this.settings.postProcessingCalloutFormat = value;
        await this.plugin.saveSettings();
      });
      text.inputEl.rows = 4;
      text.inputEl.style.width = "100%";
    });
  }
  addMaxTokens() {
    new Setting(this.contentEl).setName("Maximum post-processing length").setDesc("Set the maximum number of tokens for the post-processing output").addSlider((slider) => {
      this.maxTokensSlider = slider;
      slider.setLimits(100, 4096, 100).setValue(this.settings.postProcessingMaxTokens).setDynamicTooltip().onChange(async (value) => {
        this.settings.postProcessingMaxTokens = value;
        await this.plugin.saveSettings();
      });
    });
  }
  addTemperatureControl() {
    new Setting(this.contentEl).setName("Post-processing creativity").setDesc("Adjust the creativity level of the post-processing (0 = more focused, 1 = more creative)").addSlider((slider) => {
      this.temperatureSlider = slider;
      slider.setLimits(0, 1, 0.1).setValue(this.settings.postProcessingTemperature).setDynamicTooltip().onChange(async (value) => {
        this.settings.postProcessingTemperature = value;
        await this.plugin.saveSettings();
      });
    });
  }
  getProviderFromModel(modelId) {
    for (const [provider, models] of Object.entries(AIModels)) {
      if (models.some((model) => model.id === modelId)) {
        return provider;
      }
    }
    return null;
  }
  async updateMaxTokensLimit(modelId) {
    const model = getModelInfo(modelId);
    const maxTokens = (model == null ? void 0 : model.maxTokens) || 1e3;
    if (this.maxTokensSlider) {
      this.maxTokensSlider.sliderEl.max = maxTokens.toString();
      const currentValue = parseInt(this.maxTokensSlider.sliderEl.value);
      if (currentValue > maxTokens) {
        this.maxTokensSlider.setValue(maxTokens);
        this.settings.postProcessingMaxTokens = maxTokens;
        await this.plugin.saveSettings();
      }
    }
  }
}
