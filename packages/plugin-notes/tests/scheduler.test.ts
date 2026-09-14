/**
 * 定时调度器单测（scheduler.ts）：注入假 now / 假执行 / 假写回，逐条验证 tick 的
 * 派发、跳过、停用与容错——不触真定时器、不建真会话。
 */

import { describe, expect, it } from 'vitest'
import { SCHEDULE_RUN_TIMEOUT_MS, createScheduleRunner } from '../src/scheduler.ts'
import type { ScheduleRunnerDeps } from '../src/scheduler.ts'
import type { NoteId, NoteLane, NoteRecord, NoteSchedule, TaskStatus } from '../src/types.ts'

const NOW = new Date(2026, 0, 5, 10, 0, 0, 0).getTime()

function note(input: {
  readonly id: string;
  readonly nextAt: number;
  readonly mode?: NoteSchedule['mode'];
  readonly enabled?: boolean;
  readonly archived?: boolean;
  readonly lane?: boolean;
  readonly at?: number;
  readonly status?: TaskStatus;
  readonly run?: NoteLane['run'];
}): NoteRecord {
  const schedule: NoteSchedule = {
    enabled: input.enabled ?? true,
    mode: input.mode ?? 'daily',
    time: '09:00',
    nextAt: input.nextAt,
    ...(input.at !== undefined ? { at: input.at } : {}),
  }
  return {
    id: input.id as NoteId,
    title: 't',
    text: '',
    pinned: false,
    archived: input.archived ?? false,
    color: 'yellow',
    origin: 'user',
    createdAt: 0,
    updatedAt: 0,
    ...(input.lane === false
      ? {}
      : {
          lane: {
            status: input.status ?? ('todo' as const),
            ...(input.run !== undefined ? { run: input.run } : {}),
          },
        }),
    schedule,
  }
}

/** 假依赖：执行结果按 id 查表，写回记入 written；可注入抛错。 */
function makeDeps(input: {
  readonly notes: readonly NoteRecord[];
  readonly results?: Record<string, 'dispatched' | 'busy' | 'missing-workspace' | 'no-dispatch' | 'dispatch-failed' | 'missing'>;
  readonly throwOn?: string;
}): {
  readonly deps: ScheduleRunnerDeps;
  readonly written: { id: string; schedule: NoteSchedule | undefined }[];
  readonly executed: string[];
  readonly settled: { id: string; summary: string }[];
} {
  const written: { id: string; schedule: NoteSchedule | undefined }[] = [];
  const executed: string[] = [];
  const settled: { id: string; summary: string }[] = [];
  const deps: ScheduleRunnerDeps = {
    list: () => input.notes,
    execute: async (id: NoteId) => {
      if (input.throwOn === id) throw new Error('boom');
      executed.push(id);
      const outcome = input.results?.[id] ?? 'dispatched';
      if (outcome === 'dispatched') {
        return { ok: true, note: input.notes.find((n) => n.id === id)! };
      }
      return { ok: false, reason: outcome };
    },
    write: async (id, schedule) => {
      written.push({ id, schedule });
    },
    settle: async (id, summary) => {
      settled.push({ id, summary });
    },
    warn: () => {},
  };
  return { deps, written, executed, settled };
}

describe('createScheduleRunner', () => {
  it('只派发到期的任务便签，循环顺延下一次', async () => {
    const due = note({ id: 'due', nextAt: NOW - 1000 });
    const future = note({ id: 'future', nextAt: NOW + 60_000 });
    const archived = note({ id: 'archived', nextAt: NOW - 1000, archived: true });
    const plain = note({ id: 'plain', nextAt: NOW - 1000, lane: false });
    const off = note({ id: 'off', nextAt: NOW - 1000, enabled: false });
    const { deps, written, executed } = makeDeps({ notes: [due, future, archived, plain, off] });
    const fired = await createScheduleRunner(deps).run(NOW);
    expect(fired).toEqual(['due']);
    expect(executed).toEqual(['due']);
    expect(written).toHaveLength(1);
    expect(written[0]!.id).toBe('due');
    // 每天 09:00：NOW（10:00）之后的下一格 = 明天 09:00。
    expect(written[0]!.schedule?.nextAt).toBe(new Date(2026, 0, 6, 9, 0, 0, 0).getTime());
    expect(written[0]!.schedule?.lastFiredAt).toBe(NOW);
  })

  it('一次性日程派发成功后停用（记录保留）', async () => {
    const once = note({ id: 'once', mode: 'once', at: NOW - 1000, nextAt: NOW - 1000 });
    const { deps, written } = makeDeps({ notes: [once] });
    await createScheduleRunner(deps).run(NOW);
    expect(written[0]!.schedule?.enabled).toBe(false);
    expect(written[0]!.schedule?.lastResult).toBe('已派发');
  })

  it('任务忙（上一轮未结束）：不重复派发，写回跳过说明', async () => {
    const busy = note({ id: 'busy', nextAt: NOW - 1000 });
    const { deps, written, executed } = makeDeps({ notes: [busy], results: { busy: 'busy' } });
    const fired = await createScheduleRunner(deps).run(NOW);
    expect(fired).toEqual([]);
    expect(executed).toEqual(['busy']);
    expect(written[0]!.schedule?.lastResult).toContain('上一轮未结束');
  })

  it('派发失败：循环记原因并顺延，下一次还会再试', async () => {
    const fail = note({ id: 'fail', nextAt: NOW - 1000 });
    const { deps, written } = makeDeps({ notes: [fail], results: { fail: 'missing-workspace' } });
    await createScheduleRunner(deps).run(NOW);
    expect(written[0]!.schedule?.enabled).toBe(true);
    expect(written[0]!.schedule?.lastResult).toContain('未配置工作区');
    expect(written[0]!.schedule?.nextAt).toBeGreaterThan(NOW);
  })

  it('便签已删（missing）：不写回、不报错', async () => {
    const gone = note({ id: 'gone', nextAt: NOW - 1000 });
    const { deps, written } = makeDeps({ notes: [gone], results: { gone: 'missing' } });
    const fired = await createScheduleRunner(deps).run(NOW);
    expect(fired).toEqual([]);
    expect(written).toHaveLength(0);
  })

  it('一次性过期太久：不补跑，直接停用并记原因', async () => {
    const stale = note({ id: 'stale', mode: 'once', at: NOW - 8 * 24 * 60 * 60 * 1000, nextAt: NOW - 1000 });
    const { deps, written, executed } = makeDeps({ notes: [stale] });
    await createScheduleRunner(deps).run(NOW);
    expect(executed).toEqual([]);
    expect(written[0]!.schedule?.enabled).toBe(false);
    expect(written[0]!.schedule?.lastResult).toContain('已过期');
  })

  it('单张便签出错不影响同轮其它便签', async () => {
    const boom = note({ id: 'boom', nextAt: NOW - 1000 });
    const ok = note({ id: 'ok', nextAt: NOW - 1000 });
    const { deps, written } = makeDeps({ notes: [boom, ok], throwOn: 'boom' });
    const fired = await createScheduleRunner(deps).run(NOW);
    expect(fired).toEqual(['ok']);
    expect(written.map((w) => w.id)).toEqual(['ok']);
  })

  it('上一轮未结束时重入直接跳过（防同一张便签双派发）', async () => {
    const slow = note({ id: 'slow', nextAt: NOW - 1000 });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { deps, executed } = makeDeps({ notes: [slow] });
    const runner = createScheduleRunner({
      ...deps,
      execute: async (id) => {
        executed.push(id);
        await gate;
        return { ok: true, note: slow };
      },
    });
    const first = runner.run(NOW);
    const second = await runner.run(NOW);
    expect(second).toEqual([]);
    release?.();
    await first;
    expect(executed).toEqual(['slow']);
  })

  it('状态闸门：待规划 / 已完成到点也不派发，只顺延并记原因', async () => {
    const backlog = note({ id: 'backlog', nextAt: NOW - 1000, status: 'backlog' });
    const done = note({ id: 'done', nextAt: NOW - 1000, status: 'done' });
    const { deps, written, executed } = makeDeps({ notes: [backlog, done] });
    const fired = await createScheduleRunner(deps).run(NOW);
    expect(fired).toEqual([]);
    expect(executed).toEqual([]);
    expect(written.map((w) => w.id).sort()).toEqual(['backlog', 'done']);
    expect(written.find((w) => w.id === 'backlog')!.schedule?.lastResult).toBe('待规划中，未派发');
    expect(written.find((w) => w.id === 'done')!.schedule?.lastResult).toBe('已完成，未派发');
    // 软闸门：仍然 enabled，顺延到下一周期；拖回待办即恢复。
    expect(written.find((w) => w.id === 'backlog')!.schedule?.enabled).toBe(true);
    expect(written.find((w) => w.id === 'backlog')!.schedule?.nextAt).toBeGreaterThan(NOW);
  })

  it('状态闸门：待办照常派发（只挡待规划/已完成/已失败）', async () => {
    const { deps, executed } = makeDeps({ notes: [note({ id: 'todo', nextAt: NOW - 1000, status: 'todo' })] });
    expect(await createScheduleRunner(deps).run(NOW)).toEqual(['todo']);
    expect(executed).toEqual(['todo']);
  })

  it('状态闸门：被挡住的一次性日程不写回（等用户拖回待办）', async () => {
    const once = note({ id: 'once', mode: 'once', at: NOW - 1000, nextAt: NOW - 1000, status: 'backlog' });
    const { deps, written, executed } = makeDeps({ notes: [once] });
    await createScheduleRunner(deps).run(NOW);
    expect(executed).toEqual([]);
    expect(written).toHaveLength(0);
  })

  it('超时兜底：定时发起的 run 迟迟不 report → 交 settle 收尾', async () => {
    const stale = note({
      id: 'stale-run',
      nextAt: NOW + 60_000,
      status: 'running',
      run: { startedAt: NOW - SCHEDULE_RUN_TIMEOUT_MS, by: 'schedule' },
    });
    const fresh = note({
      id: 'fresh-run',
      nextAt: NOW + 60_000,
      status: 'running',
      run: { startedAt: NOW - 1000, by: 'schedule' },
    });
    const manual = note({
      id: 'manual-run',
      nextAt: NOW + 60_000,
      status: 'running',
      run: { startedAt: NOW - SCHEDULE_RUN_TIMEOUT_MS, by: 'user' },
    });
    const finished = note({
      id: 'finished-run',
      nextAt: NOW + 60_000,
      status: 'running',
      run: { startedAt: NOW - SCHEDULE_RUN_TIMEOUT_MS, finishedAt: NOW - 1000, by: 'schedule' },
    });
    const { deps, settled } = makeDeps({ notes: [stale, fresh, manual, finished] });
    await createScheduleRunner(deps).run(NOW);
    expect(settled).toEqual([{ id: 'stale-run', summary: '超时未收尾' }]);
  })
});