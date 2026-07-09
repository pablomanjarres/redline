import { ComputeResult, FieldSpec, DatasetInventory } from '@redline/contracts';
import type { ScenarioId } from '@redline/contracts';
import type { ComputeInput, ComputeTarget } from '../compute-target.js';

export type RemoteKind = 'local' | 'cloudrun' | 'endpoint';

const ENV_VAR: Record<RemoteKind, string> = {
  local: 'REDLINE_ENGINE_CMD',
  cloudrun: 'REDLINE_CLOUDRUN_URL',
  endpoint: 'REDLINE_ENDPOINT_URL',
};

/**
 * A target backed by the real Python rigor engine. `local` shells out to a
 * command (REDLINE_ENGINE_CMD) that reads a job spec on stdin and prints a
 * ComputeResult; `cloudrun`/`endpoint` POST the job to an HTTP URL. Every path
 * returns the SAME ComputeResult shape the fixture returns, validated against
 * the contract before it is handed back.
 *
 * When its env var is unset the target reports `available: false` and refuses to
 * run, so an unwired backend is never dressed up as a live control.
 */
export class RemoteTarget implements ComputeTarget {
  readonly id: RemoteKind;

  constructor(kind: RemoteKind) {
    this.id = kind;
  }

  get available(): boolean {
    return Boolean(process.env[ENV_VAR[this.id]]);
  }

  async inspect(input: { scenarioId: ScenarioId }): Promise<DatasetInventory> {
    const raw = await this.call({ op: 'inspect', scenarioId: input.scenarioId });
    const payload = raw as { inventory?: unknown };
    // Accept either a bare inventory or an { inventory } envelope, then validate
    // against the contract so a real backend can never hand back a loose shape.
    return DatasetInventory.parse(payload.inventory ?? raw);
  }

  async inferFields(input: { scenarioId: ScenarioId }): Promise<FieldSpec[]> {
    const raw = await this.call({ op: 'resolve_fields', scenarioId: input.scenarioId });
    const payload = raw as { fields?: unknown };
    return FieldSpec.array().parse(payload.fields);
  }

  async computeCheck(input: ComputeInput): Promise<ComputeResult> {
    const raw = await this.call({
      op: 'check',
      scenarioId: input.scenarioId,
      checkId: input.checkId,
      config: input.config,
      fields: input.fields,
    });
    return ComputeResult.parse(raw);
  }

  private async call(payload: unknown): Promise<unknown> {
    if (!this.available) {
      throw new Error(
        `RemoteTarget '${this.id}' is not wired. Set ${ENV_VAR[this.id]} to enable it.`,
      );
    }
    return this.id === 'local' ? this.callLocal(payload) : this.callHttp(payload);
  }

  private async callLocal(payload: unknown): Promise<unknown> {
    const cmd = process.env.REDLINE_ENGINE_CMD ?? '';
    const parts = cmd.split(' ').filter(Boolean);
    const bin = parts[0];
    if (!bin) throw new Error('REDLINE_ENGINE_CMD is empty.');
    const { spawn } = await import('node:child_process');
    return new Promise<unknown>((resolve, reject) => {
      const child = spawn(bin, parts.slice(1), { stdio: ['pipe', 'pipe', 'inherit'] });
      let out = '';
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`redline engine exited with code ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(out));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }

  private async callHttp(payload: unknown): Promise<unknown> {
    const url = this.id === 'cloudrun' ? process.env.REDLINE_CLOUDRUN_URL : process.env.REDLINE_ENDPOINT_URL;
    if (!url) throw new Error(`${ENV_VAR[this.id]} is empty.`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`redline engine HTTP ${res.status}`);
    return res.json();
  }
}

/** Construct a remote target for one backend kind. */
export function createRemoteTarget(kind: RemoteKind): RemoteTarget {
  return new RemoteTarget(kind);
}
