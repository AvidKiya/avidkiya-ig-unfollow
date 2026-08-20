/**
 * Unfollow queue — persisted in chrome.storage.local so it survives the
 * dashboard tab closing. Design guarantees:
 *   - Never Unfollow / protected users can never enter the queue
 *     (double-checked in dashboard.js AND here).
 *   - If the tab closes mid-run, state becomes needsResume=true and NOTHING
 *     continues automatically. The next dashboard load can only offer Resume.
 *   - On 429 / action-block the runner stops immediately (status 'blocked')
 *     and surfaces the suggested cooldown.
 */

import { STORAGE_KEYS, NET } from './config.js';
import { get, set, appendHistory, bumpTodayCount } from './storage.js';
import { unfollowUser, sleep, IGError } from './instagram-api.js';

const STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  BLOCKED: 'blocked',
  DONE: 'done',
};

export function getQueue() {
  return get(STORAGE_KEYS.QUEUE, null);
}

export async function clearQueue() {
  await set(STORAGE_KEYS.QUEUE, null);
}

/** Human-mode delay: uniform random in [min,max] + natural jitter. */
export function humanDelaySeconds(preset) {
  const base = preset.delayMin + Math.random() * Math.max(0, preset.delayMax - preset.delayMin);
  // Simple bell-ish jitter (sum of two uniforms ≈ normal-ish), ±15%.
  const jitter = (Math.random() + Math.random() - 1) * 0.15 * base;
  return Math.max(3, base + jitter);
}

function batchPauseSeconds(preset) {
  return preset.batchPauseMin + Math.random() * Math.max(0, preset.batchPauseMax - preset.batchPauseMin);
}

export class QueueRunner {
  /**
   * @param {object} cbs { onProgress(queue), onItemDone(entry), onStatus(status,queue), csrf }
   */
  constructor(cbs) {
    this.cbs = cbs;
    this.abort = new AbortController();
    this.saveQueued = 0;
  }

  /** Build and persist a new queue. items already exclude protected users. */
  static async create(items, preset, humanMode) {
    const queue = {
      items: items.map((u) => ({ id: String(u.id), username: u.username, fullName: u.fullName || '', profilePic: u.profilePic || '' })),
      index: 0,
      status: STATUS.PAUSED, // becomes RUNNING only via run()
      createdAt: Date.now(),
      presetId: preset.id,
      preset: { ...preset },
      humanMode: !!humanMode,
      log: [],
      doneCount: 0,
      failCount: 0,
      needsResume: false,
      lastError: null,
      etaSeconds: Math.round(items.length * ((preset.delayMin + preset.delayMax) / 2 + 2)),
    };
    await set(STORAGE_KEYS.QUEUE, queue);
    return queue;
  }

  async persist(queue) {
    await set(STORAGE_KEYS.QUEUE, queue);
    this.cbs.onProgress?.(queue);
  }

  async run() {
    const queue = await getQueue();
    if (!queue || queue.status === STATUS.DONE) return queue;
    queue.status = STATUS.RUNNING;
    queue.needsResume = false;
    await this.persist(queue);
    this.cbs.onStatus?.(STATUS.RUNNING, queue);

    const { preset, humanMode } = queue;
    let sinceBatch = 0;

    while (queue.index < queue.items.length) {
      if (this.abort.signal.aborted) break;
      const item = queue.items[queue.index];
      const started = Date.now();

      try {
        await unfollowUser(item.id, this.cbs.csrf?.(), this.abort.signal);
        const entry = { ts: Date.now(), id: item.id, username: item.username, ok: true, ms: Date.now() - started, source: 'queue' };
        queue.log.push(entry);
        queue.doneCount += 1;
        queue.index += 1;
        sinceBatch += 1;
        await appendHistory(entry);
        await bumpTodayCount(1);
        this.cbs.onItemDone?.(entry, queue);
      } catch (err) {
        if (err?.name === 'AbortError' || this.abort.signal.aborted) break;
        const igErr = err instanceof IGError ? err : new IGError('unknown', err?.message || 'unknown');
        const entry = { ts: Date.now(), id: item.id, username: item.username, ok: false, error: igErr.kind, message: igErr.message, source: 'queue' };
        queue.log.push(entry);
        queue.failCount += 1;
        queue.index += 1; // skip failed item, continue with next
        queue.lastError = igErr.message;
        await appendHistory(entry);
        this.cbs.onItemDone?.(entry, queue);

        if (igErr.kind === 'rate' || igErr.kind === 'block') {
          queue.status = STATUS.BLOCKED;
          queue.cooldownMin = NET.BLOCK_COOLDOWN_MIN;
          await this.persist(queue);
          this.cbs.onStatus?.(STATUS.BLOCKED, queue);
          return queue;
        }
        if (igErr.kind === 'auth') {
          queue.status = STATUS.PAUSED; // session lost; ask user to re-login, then resume
          queue.needsResume = true;
          await this.persist(queue);
          this.cbs.onStatus?.(STATUS.PAUSED, queue);
          return queue;
        }
      }

      await this.persist(queue);

      // pacing
      if (queue.index < queue.items.length) {
        try {
          if (humanMode && sinceBatch >= preset.batchSize) {
            sinceBatch = 0;
            await sleep(batchPauseSeconds(preset) * 1000, this.abort.signal);
          } else {
            await sleep(humanDelaySeconds(preset) * 1000, this.abort.signal);
          }
        } catch {
          break; // aborted during sleep
        }
      }
    }

    if (this.abort.signal.aborted) {
      // stop() may have marked the queue STOPPED while we were busy — respect it.
      const fresh = await getQueue();
      queue.status = fresh?.status === STATUS.STOPPED ? STATUS.STOPPED : STATUS.PAUSED;
    } else if (queue.index >= queue.items.length) {
      queue.status = STATUS.DONE;
    }
    await this.persist(queue);
    this.cbs.onStatus?.(queue.status, queue);
    return queue;
  }

  pause() {
    this.abort.abort('pause');
  }

  async stop() {
    this.abort.abort('stop');
    const q = await getQueue();
    if (q && q.status !== STATUS.DONE) {
      q.status = STATUS.STOPPED;
      q.needsResume = false;
      await set(STORAGE_KEYS.QUEUE, q);
    }
  }

  /** Called when the tab is about to unload: mark unfinished work as resumable. */
  static async markDirtyOnUnload() {
    const q = await getQueue();
    if (q && (q.status === STATUS.RUNNING || q.status === STATUS.PAUSED) && q.index < q.items.length) {
      q.status = STATUS.PAUSED;
      q.needsResume = true;
      await set(STORAGE_KEYS.QUEUE, q);
    }
  }
}

export { STATUS };
