var _JobStore = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.writeChain = Promise.resolve();
  }
  async upsertJob(job) {
    await this.withState(async (state) => {
      const idx = state.jobs.findIndex((j) => j.jobId === job.jobId);
      if (idx >= 0) {
        state.jobs[idx] = { ...state.jobs[idx], ...job, updatedAt: new Date().toISOString() };
      } else {
        state.jobs.push(job);
      }
    });
  }
  async updateJobStatus(jobId, status, error) {
    await this.withState(async (state) => {
      const idx = state.jobs.findIndex((j) => j.jobId === jobId);
      if (idx < 0)
        return;
      state.jobs[idx] = {
        ...state.jobs[idx],
        status,
        updatedAt: new Date().toISOString(),
        error
      };
    });
  }
  async upsertCheckpoint(checkpoint) {
    await this.withState(async (state) => {
      const idx = state.checkpoints.findIndex(
        (c) => c.jobId === checkpoint.jobId && c.index === checkpoint.index
      );
      if (idx >= 0) {
        state.checkpoints[idx] = {
          ...state.checkpoints[idx],
          ...checkpoint,
          updatedAt: new Date().toISOString()
        };
      } else {
        state.checkpoints.push(checkpoint);
      }
    });
  }
  async getIncompleteJobs() {
    const state = await this.readState();
    return state.jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "failed");
  }
  async getLatestIncompleteJob(kind, targetFile) {
    const jobs = await this.getIncompleteJobs();
    return jobs.filter((j) => kind ? j.kind === kind : true).filter((j) => targetFile ? j.targetFile === targetFile : true).sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1)[0];
  }
  async getJob(jobId) {
    const state = await this.readState();
    return state.jobs.find((j) => j.jobId === jobId);
  }
  async getCheckpoints(jobId) {
    const state = await this.readState();
    return state.checkpoints.filter((c) => c.jobId === jobId).sort((a, b) => a.index - b.index);
  }
  async getLatestCommittedCheckpoint(jobId, stage) {
    const checkpoints = await this.getCheckpoints(jobId);
    return checkpoints.filter((c) => c.stage === stage && c.status === "committed").sort((a, b) => {
      if (a.index !== b.index)
        return b.index - a.index;
      return a.updatedAt < b.updatedAt ? 1 : -1;
    })[0];
  }
  async prune(options) {
    var _a, _b, _c;
    const maxJobs = (_a = options == null ? void 0 : options.maxJobs) != null ? _a : 500;
    const maxCheckpoints = (_b = options == null ? void 0 : options.maxCheckpoints) != null ? _b : 2e3;
    const maxAgeMs = (_c = options == null ? void 0 : options.maxAgeMs) != null ? _c : 14 * 24 * 60 * 60 * 1e3;
    const cutoff = Date.now() - maxAgeMs;
    await this.withState(async (state) => {
      state.jobs = state.jobs.filter((job) => {
        if (job.status === "queued" || job.status === "running")
          return true;
        return new Date(job.updatedAt).getTime() >= cutoff;
      }).sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1).slice(0, maxJobs);
      const keepJobIds = new Set(state.jobs.map((j) => j.jobId));
      state.checkpoints = state.checkpoints.filter((cp) => keepJobIds.has(cp.jobId)).sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1).slice(0, maxCheckpoints);
    });
  }
  async demoteStaleFailedToCanceled(maxAgeMs) {
    let changed = 0;
    const cutoff = Date.now() - Math.max(0, maxAgeMs);
    await this.withState(async (state) => {
      const nowIso = new Date().toISOString();
      for (const job of state.jobs) {
        if (job.status !== "failed")
          continue;
        const updatedAtMs = new Date(job.updatedAt).getTime();
        if (!Number.isFinite(updatedAtMs) || updatedAtMs > cutoff)
          continue;
        job.status = "canceled";
        job.updatedAt = nowIso;
        changed += 1;
      }
    });
    return changed;
  }
  async withState(mutator) {
    const run = this.writeChain.then(async () => {
      const state = await this.readState();
      await mutator(state);
      await this.writeState(state);
    });
    this.writeChain = run.catch((err) => {
      console.error("[NeuroVox][JobStore] State write failed:", err);
    });
    await run;
  }
  async readState() {
    const adapter = this.plugin.app.vault.adapter;
    await this.ensureDir(adapter);
    if (!await adapter.exists(_JobStore.FILE)) {
      return { jobs: [], checkpoints: [] };
    }
    try {
      const raw = await adapter.read(_JobStore.FILE);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        await this.quarantineCorruptFile(adapter, _JobStore.FILE, raw);
        return { jobs: [], checkpoints: [] };
      }
      return {
        jobs: Array.isArray(parsed == null ? void 0 : parsed.jobs) ? parsed.jobs : [],
        checkpoints: Array.isArray(parsed == null ? void 0 : parsed.checkpoints) ? parsed.checkpoints : []
      };
    } catch (e) {
      return { jobs: [], checkpoints: [] };
    }
  }
  async writeState(state) {
    const adapter = this.plugin.app.vault.adapter;
    await this.ensureDir(adapter);
    await adapter.write(_JobStore.FILE, JSON.stringify(state, null, 2));
  }
  async ensureDir(adapter) {
    if (!await adapter.exists(_JobStore.BASE_DIR)) {
      await adapter.mkdir(_JobStore.BASE_DIR);
    }
  }
  async quarantineCorruptFile(adapter, path, raw) {
    try {
      const quarantinePath = `${path}.corrupt.${Date.now()}.json`;
      await adapter.write(quarantinePath, raw);
      await adapter.remove(path);
    } catch (e) {
    }
  }
};
var JobStore = _JobStore;
JobStore.BASE_DIR = ".obsidian/plugins/neurovox/recovery";
JobStore.FILE = ".obsidian/plugins/neurovox/recovery/jobs.json";
