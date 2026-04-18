class RuntimeLogger {
  static LOG_DIR = ".obsidian/plugins/neurovox/logs";
  static LOG_FILE = ".obsidian/plugins/neurovox/logs/latest.jsonl";
  static MAX_BYTES_DEFAULT = 10 * 1024 * 1024;
  static MAX_AGE_MS_DEFAULT = 7 * 24 * 60 * 60 * 1e3;
  static logWriteChain = Promise.resolve();
  static dirEnsured = false;
  static recentWriteFailures = [];
  static _hasAppend = void 0;

  static createContext(prefix = "job") {
    const now = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return {
      jobId: `${prefix}_${now}_${rand}`,
      correlationId: `corr_${now}_${rand}`
    };
  }
  static async log(plugin, context, eventName, details = {}) {
    const payload = {
      eventName,
      timestamp: new Date().toISOString(),
      jobId: context.jobId,
      correlationId: context.correlationId,
      provider: plugin.settings.transcriptionProvider,
      model: plugin.settings.transcriptionModel,
      ...details
    };
    console.debug("[NeuroVox][Runtime]", payload);
    this.logWriteChain = this.logWriteChain.then(async () => {
      const adapter = plugin.app.vault.adapter;
      await this.ensureLogDir(adapter);
      const line = `${JSON.stringify(payload)}
`;
      if (this._hasAppend === void 0) {
        this._hasAppend = typeof adapter.append === "function";
      }
      if (this._hasAppend) {
        await adapter.append(this.LOG_FILE, line);
        return;
      }
      const exists = await adapter.exists(this.LOG_FILE);
      if (exists) {
        const prev = await adapter.read(this.LOG_FILE);
        await adapter.write(this.LOG_FILE, `${prev}${line}`);
        return;
      }
      await adapter.write(this.LOG_FILE, line);
    }).catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.recentWriteFailures.push({ at: new Date().toISOString(), error: reason });
      if (this.recentWriteFailures.length > 50) {
        this.recentWriteFailures = this.recentWriteFailures.slice(-50);
      }
      console.error("[NeuroVox][Runtime] log write failed", { reason, payload });
    });
    await this.logWriteChain;
  }
  static async prune(plugin, options) {
    var _a, _b;
    const maxBytes = (_a = options == null ? void 0 : options.maxBytes) != null ? _a : this.MAX_BYTES_DEFAULT;
    const maxAgeMs = (_b = options == null ? void 0 : options.maxAgeMs) != null ? _b : this.MAX_AGE_MS_DEFAULT;
    this.logWriteChain = this.logWriteChain.then(async () => {
      const adapter = plugin.app.vault.adapter;
      const exists = await adapter.exists(this.LOG_FILE);
      if (!exists)
        return;
      const raw = await adapter.read(this.LOG_FILE);
      if (!raw)
        return;
      const cutoff = Date.now() - maxAgeMs;
      const lines = raw.split("\n").filter(Boolean);
      const retained = lines.filter((line) => {
        try {
          const parsed = JSON.parse(line);
          const ts = new Date(parsed.timestamp).getTime();
          return Number.isFinite(ts) && ts >= cutoff;
        } catch (e) {
          return false;
        }
      });
      let pruned = retained.join("\n");
      if (pruned.length > 0)
        pruned += "\n";
      if (pruned.length > maxBytes) {
        pruned = pruned.slice(pruned.length - maxBytes);
        const firstNewline = pruned.indexOf("\n");
        if (firstNewline >= 0) {
          pruned = pruned.slice(firstNewline + 1);
        }
      }
      await adapter.write(this.LOG_FILE, pruned);
    }).catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      console.error("[NeuroVox][Runtime] prune failed", { reason });
    });
    await this.logWriteChain;
  }
  static async ensureLogDir(adapter) {
    if (this.dirEnsured)
      return;
    const exists = await adapter.exists(this.LOG_DIR);
    if (!exists) {
      await adapter.mkdir(this.LOG_DIR);
    }
    this.dirEnsured = true;
  }
}
