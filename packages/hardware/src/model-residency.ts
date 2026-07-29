import { ProviderError } from '@intentsmith/inference';

/**
 * Single-GPU model residency.
 *
 * Measured, not assumed: one 27B model at Q4 occupied 23.4 GiB of a 24 GiB
 * RTX 3090 during the probe, and loading a second large model while the first
 * was still resident under `keep_alive: 10m` failed. Two large models do not
 * fit, so residency has to be scheduled explicitly.
 *
 * The rule this enforces is simple and unglamorous: one model is resident at a
 * time, a switch waits for the running inference to finish, the old model is
 * unloaded through the daemon's own API and *verified gone* before the next one
 * is asked for. Nothing here shells out — no `ollama` CLI, no `nvidia-smi`, no
 * process at all — because a product that runs a CLI to manage its own memory
 * inherits every failure mode of that CLI's environment.
 *
 * It deliberately does not rely on the daemon eventually evicting a model.
 * "Eventually" is what produced the failure in the first place.
 */

/** The daemon operations residency needs. Kept tiny so it is easy to fake. */
export type ResidencyProvider = {
  /** Models currently held in VRAM. */
  loadedModels(signal?: AbortSignal): Promise<Array<{ model: string; sizeVramBytes?: number }>>;
  /** Asks the daemon to release a model now, via `keep_alive: 0`. */
  unloadModel(modelId: string, signal?: AbortSignal): Promise<void>;
};

/**
 * What to do with a model once a job finishes with it.
 *
 * Derived from the queue rather than fixed, because a universal TTL is wrong in
 * both directions: holding VRAM for ten minutes starves the next job when it
 * needs a different model, and dropping it immediately wastes a reload when the
 * next job wants the same one.
 */
export type KeepAlivePlan =
  | { action: 'retain'; seconds: number; reason: string }
  | { action: 'unload'; reason: string };

export type ResidencyLease = {
  modelId: string;
  /** Finishes the job and applies the keep-alive plan for whatever is next. */
  release(): Promise<KeepAlivePlan>;
};

export type ModelResidencyOptions = {
  provider: ResidencyProvider;
  /** Seconds to hold a model when the next queued job wants the same one. */
  retainSameModelSeconds?: number;
  /** Seconds to hold a model when nothing is queued. */
  idleRetainSeconds?: number;
  /** How many times to re-check that an unloaded model is really gone. */
  unloadVerifyAttempts?: number;
  /** Delay between those checks. Injected so tests need no wall-clock time. */
  wait?: (ms: number) => Promise<void>;
  unloadVerifyDelayMs?: number;
};

type Waiter = {
  modelId: string;
  /** Monotonic sequence, used to keep the queue fair. */
  seq: number;
  resolve: (lease: ResidencyLease) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

const defaultWait = (ms: number): Promise<void> =>
  new Promise(resolve => {
    const handle = setTimeout(resolve, ms);
    handle.unref?.();
  });

export class ModelResidencyManager {
  private readonly queue: Waiter[] = [];
  private active: { modelId: string } | undefined;
  private resident: string | undefined;
  private sequence = 0;
  private draining = false;

  constructor(private readonly options: ModelResidencyOptions) {}

  /** Model currently held in VRAM, as far as this manager knows. */
  get residentModel(): string | undefined {
    return this.resident;
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  /**
   * Waits for exclusive use of one model on the GPU.
   *
   * Requests are served strictly in arrival order. Serving same-model requests
   * first would be faster and would let a stream of fast jobs starve a deep one
   * indefinitely, which is the failure nobody notices until a large job never
   * runs.
   */
  async acquire(modelId: string, signal?: AbortSignal): Promise<ResidencyLease> {
    if (signal?.aborted) {
      throw new ProviderError('REQUEST_CANCELLED', 'Request was cancelled before it queued for the GPU.');
    }

    return await new Promise<ResidencyLease>((resolve, reject) => {
      const waiter: Waiter = { modelId, seq: (this.sequence += 1), resolve, reject };
      if (signal) {
        waiter.signal = signal;
        waiter.onAbort = () => {
          // A cancelled request leaves the queue rather than being handed a
          // lease nobody is waiting for; that lease would pin the GPU until it
          // was released by code that had already given up.
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new ProviderError('REQUEST_CANCELLED', 'Request was cancelled while queued for the GPU.'));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining || this.active) return;
    this.draining = true;
    try {
      while (!this.active) {
        const waiter = this.queue.shift();
        if (!waiter) return;
        if (waiter.signal?.aborted) continue;
        if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort);

        try {
          await this.ensureResident(waiter.modelId, waiter.signal);
        } catch (error) {
          waiter.reject(error);
          continue;
        }

        this.active = { modelId: waiter.modelId };
        waiter.resolve(this.leaseFor(waiter.modelId));
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Makes `modelId` the resident model, unloading whatever else is there.
   *
   * The verification step is the point. Asking the daemon to unload and
   * assuming it worked is how a second large model gets requested into a GPU
   * that is still full, and the resulting error looks like a model failure
   * rather than what it is.
   */
  private async ensureResident(modelId: string, signal?: AbortSignal): Promise<void> {
    if (this.resident === modelId) return;

    const loaded = await this.options.provider.loadedModels(signal);
    const others = loaded.map(entry => entry.model).filter(model => model !== modelId);
    if (others.length === 0) {
      this.resident = loaded.some(entry => entry.model === modelId) ? modelId : undefined;
      if (this.resident === undefined) this.resident = modelId;
      return;
    }

    for (const other of others) {
      await this.options.provider.unloadModel(other, signal);
    }

    const attempts = this.options.unloadVerifyAttempts ?? 5;
    const wait = this.options.wait ?? defaultWait;
    const delayMs = this.options.unloadVerifyDelayMs ?? 200;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const still = (await this.options.provider.loadedModels(signal)).map(entry => entry.model);
      if (!still.some(model => others.includes(model))) {
        this.resident = modelId;
        return;
      }
      if (attempt < attempts - 1) await wait(delayMs);
    }

    // A distinct code on purpose. This is not an inference failure and not a
    // broken model: the GPU is occupied and the daemon did not let go. Treating
    // it as a model failure would blame the wrong thing and hide a scheduling
    // problem behind a retry of the wrong operation.
    throw new ProviderError(
      'MODEL_RESIDENCY_CONFLICT',
      `Cannot load "${modelId}": ${others.join(', ')} is still resident in VRAM after being asked to unload.`,
      true,
    );
  }

  private leaseFor(modelId: string): ResidencyLease {
    let released = false;
    return {
      modelId,
      release: async (): Promise<KeepAlivePlan> => {
        if (released) throw new Error('This residency lease was already released.');
        released = true;
        const plan = this.planFor(modelId);
        this.active = undefined;

        if (plan.action === 'unload') {
          try {
            await this.options.provider.unloadModel(modelId);
            this.resident = undefined;
          } catch {
            // The next acquire verifies residency anyway, so a failed eager
            // unload delays the switch rather than corrupting the state.
          }
        }

        void this.drain();
        return plan;
      },
    };
  }

  /**
   * Chooses what happens to the model just used, from what is actually queued.
   */
  private planFor(modelId: string): KeepAlivePlan {
    const next = this.queue.find(waiter => !waiter.signal?.aborted);
    if (!next) {
      return {
        action: 'retain',
        seconds: this.options.idleRetainSeconds ?? 300,
        reason: 'Nothing is queued, so the model is held for the configured idle window.',
      };
    }
    if (next.modelId === modelId) {
      return {
        action: 'retain',
        seconds: this.options.retainSameModelSeconds ?? 60,
        reason: 'The next queued job uses the same model, so reloading it would be pure waste.',
      };
    }
    return {
      action: 'unload',
      reason: 'The next queued job needs a different model, and two large models do not fit on one GPU.',
    };
  }
}
