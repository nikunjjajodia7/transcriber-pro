var _LocalQueueBackend = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.writeChain = Promise.resolve();
    this.dirEnsured = false;
  }
  async enqueue(payload) {
    const now = new Date().toISOString();
    const job = {
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "queued",
      payload,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now
    };
    await this.withState(async (state) => {
      state.jobs.push(job);
    });
    return job;
  }
  async claim(workerId, leaseMs, preferredJobId) {
    let result = null;
    await this.withState(async (state) => {
      const nowMs = Date.now();
      const claimable = state.jobs.filter((j) => this.canBeClaimed(j, nowMs)).sort((a, b) => a.createdAt < b.createdAt ? -1 : 1);
      const next = (preferredJobId ? claimable.find((j) => j.id === preferredJobId) : void 0) || claimable[0];
      if (!next)
        return;
      const leaseToken = this.newLeaseToken();
      next.status = "claimed";
      next.leaseOwner = workerId;
      next.leaseToken = leaseToken;
      next.leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
      next.updatedAt = new Date().toISOString();
      next.attemptCount += 1;
      result = { job: { ...next }, leaseToken };
    });
    return result;
  }
  async heartbeat(jobId, workerId, leaseToken, leaseMs) {
    await this.withState(async (state) => {
      const job = this.mustGetJob(state, jobId);
      this.assertLease(job, workerId, leaseToken);
      if (job.status !== "claimed" && job.status !== "running")
        return;
      job.status = "running";
      job.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      job.updatedAt = new Date().toISOString();
    });
  }
  async complete(jobId, workerId, leaseToken, resultRef) {
    await this.withState(async (state) => {
      const job = this.mustGetJob(state, jobId);
      if (job.status === "completed")
        return;
      this.assertLease(job, workerId, leaseToken);
      job.status = "completed";
      job.resultRef = resultRef;
      job.updatedAt = new Date().toISOString();
      this.clearLease(job);
    });
  }
  async fail(jobId, workerId, leaseToken, reason, retryAt) {
    await this.withState(async (state) => {
      const job = this.mustGetJob(state, jobId);
      this.assertLease(job, workerId, leaseToken);
      job.reason = reason;
      job.retryAt = retryAt;
      job.status = retryAt ? "retry_scheduled" : "failed";
      job.updatedAt = new Date().toISOString();
      this.clearLease(job);
    });
  }
  async retry(jobId, reason) {
    await this.withState(async (state) => {
      const job = this.mustGetJob(state, jobId);
      if (job.status !== "failed" && job.status !== "retry_scheduled")
        return;
      job.status = "queued";
      job.reason = reason;
      job.updatedAt = new Date().toISOString();
      job.retryAt = void 0;
      this.clearLease(job);
    });
  }
  async getSnapshot() {
    const state = await this.readState();
    return [...state.jobs].sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1);
  }
  async prune(options) {
    var _a, _b;
    const maxJobs = (_a = options == null ? void 0 : options.maxJobs) != null ? _a : 500;
    const maxAgeMs = (_b = options == null ? void 0 : options.maxAgeMs) != null ? _b : 14 * 24 * 60 * 60 * 1e3;
    const cutoff = Date.now() - maxAgeMs;
    await this.withState(async (state) => {
      const retained = state.jobs.filter((job) => {
        if (job.status === "queued" || job.status === "claimed" || job.status === "running" || job.status === "retry_scheduled") {
          return true;
        }
        return new Date(job.updatedAt).getTime() >= cutoff;
      }).sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1).slice(0, maxJobs);
      state.jobs = retained;
    });
  }
  canBeClaimed(job, nowMs) {
    if (job.status === "queued")
      return true;
    if (job.status === "retry_scheduled") {
      return !!job.retryAt && new Date(job.retryAt).getTime() <= nowMs;
    }
    if ((job.status === "claimed" || job.status === "running") && job.leaseExpiresAt) {
      return new Date(job.leaseExpiresAt).getTime() < nowMs;
    }
    return false;
  }
  mustGetJob(state, jobId) {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job)
      throw new Error(`Queue job not found: ${jobId}`);
    return job;
  }
  assertLease(job, workerId, leaseToken) {
    if (job.leaseOwner !== workerId || job.leaseToken !== leaseToken) {
      throw new Error("Lease validation failed");
    }
  }
  clearLease(job) {
    job.leaseOwner = void 0;
    job.leaseToken = void 0;
    job.leaseExpiresAt = void 0;
  }
  newLeaseToken() {
    return `lease_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  async withState(mutator) {
    const run = this.writeChain.then(async () => {
      const state = await this.readState();
      await mutator(state);
      await this.writeState(state);
    });
    this.writeChain = run.catch((err) => {
      console.error("[NeuroVox][Queue] State write failed:", err);
    });
    await run;
  }
  async readState() {
    const adapter = this.plugin.app.vault.adapter;
    await this.ensureDir(adapter);
    if (!await adapter.exists(_LocalQueueBackend.FILE)) {
      return { jobs: [] };
    }
    try {
      const raw = await adapter.read(_LocalQueueBackend.FILE);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        await this.quarantineCorruptFile(adapter, _LocalQueueBackend.FILE, raw);
        return { jobs: [] };
      }
      return { jobs: Array.isArray(parsed == null ? void 0 : parsed.jobs) ? parsed.jobs : [] };
    } catch (e) {
      return { jobs: [] };
    }
  }
  async writeState(state) {
    const adapter = this.plugin.app.vault.adapter;
    await this.ensureDir(adapter);
    await adapter.write(_LocalQueueBackend.FILE, JSON.stringify(state, null, 2));
  }
  async ensureDir(adapter) {
    if (this.dirEnsured) return;
    if (!await adapter.exists(_LocalQueueBackend.BASE_DIR)) {
      await adapter.mkdir(_LocalQueueBackend.BASE_DIR);
    }
    this.dirEnsured = true;
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
var LocalQueueBackend = _LocalQueueBackend;
LocalQueueBackend.BASE_DIR = ".obsidian/plugins/neurovox/queue";
LocalQueueBackend.FILE = ".obsidian/plugins/neurovox/queue/local-queue.json";
