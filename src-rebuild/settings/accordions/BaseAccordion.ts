import { Setting, setIcon } from 'obsidian';

export class BaseAccordion {
  constructor(containerEl, title, description = "") {
    this.isOpen = false;
    this.containerEl = containerEl;
    this.accordionEl = this.containerEl.createDiv({ cls: "neurovox-accordion" });
    this.headerEl = this.accordionEl.createDiv({ cls: "neurovox-accordion-header" });
    const titleWrapper = this.headerEl.createDiv({ cls: "neurovox-accordion-title-wrapper" });
    titleWrapper.createSpan({ text: title, cls: "neurovox-accordion-title" });
    this.toggleIcon = this.headerEl.createSpan({ cls: "neurovox-accordion-toggle" });
    this.updateToggleIcon();
    if (description) {
      const descriptionEl = this.accordionEl.createDiv({ cls: "neurovox-accordion-description" });
      descriptionEl.createSpan({ text: description });
    }
    this.contentEl = this.accordionEl.createDiv({ cls: "neurovox-accordion-content" });
    this.contentEl.style.display = "none";
    this.headerEl.addEventListener("click", () => this.toggleAccordion());
  }
  toggleAccordion() {
    this.isOpen = !this.isOpen;
    this.contentEl.style.display = this.isOpen ? "block" : "none";
    this.updateToggleIcon();
    this.accordionEl.classList.toggle("neurovox-accordion-open", this.isOpen);
  }
  updateToggleIcon() {
    this.toggleIcon.empty();
    (0, setIcon)(this.toggleIcon, "chevron-right");
    this.toggleIcon.classList.toggle("neurovox-accordion-icon-open", this.isOpen);
  }
  createSettingItem(name, desc) {
    const setting = new Setting(this.contentEl);
    setting.setName(name).setDesc(desc);
    return setting;
  }
}
