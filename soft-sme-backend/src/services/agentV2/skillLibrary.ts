import { Pool } from 'pg';

export interface SkillWorkflowRecord {
  id: string;
  name: string;
  version: number;
  description: string | null;
  entrypoint: string;
  parameters: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertSkillWorkflowInput {
  name: string;
  version?: number;
  description?: string | null;
  entrypoint: string;
  parameters?: Record<string, unknown>;
}

export interface SkillRunReflectionInput {
  skillWorkflowId: string;
  runId: string;
  outcome: string;
  success: boolean;
  verificationPayload?: Record<string, unknown> | null;
  latencyMs?: number | null;
}

export interface SkillRunReflectionRecord {
  id: string;
  skillWorkflowId: string;
  runId: string;
  outcome: string;
  success: boolean;
  verificationPayload: Record<string, unknown> | null;
  latencyMs: number | null;
  createdAt: Date;
}

const coerceJson = (value: unknown): Record<string, unknown> => {
  if (value == null) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    console.warn('[AgentSkillLibrary] Failed to parse JSON payload:', error);
  }
  return {};
};

export class AgentSkillLibraryService {
  constructor(private readonly pool: Pool) {}

  async listWorkflows(): Promise<SkillWorkflowRecord[]> {
    const result = await this.pool.query(
      `SELECT id, name, version, description, entrypoint, parameters, created_at, updated_at
         FROM skill_workflows
        ORDER BY updated_at DESC`
    );

    return result.rows.map((row) => this.mapWorkflow(row));
  }

  async getWorkflowByName(name: string): Promise<SkillWorkflowRecord | null> {
    const result = await this.pool.query(
      `SELECT id, name, version, description, entrypoint, parameters, created_at, updated_at
         FROM skill_workflows
        WHERE name = $1
        ORDER BY version DESC
        LIMIT 1`,
      [name]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return this.mapWorkflow(result.rows[0]);
  }

  async upsertWorkflow(input: UpsertSkillWorkflowInput): Promise<SkillWorkflowRecord> {
    const payload = {
      name: input.name.trim(),
      version: Number.isFinite(input.version) ? Number(input.version) : 1,
      description: input.description ?? null,
      entrypoint: input.entrypoint.trim(),
      parameters: input.parameters ?? {},
    };

    if (!payload.name) {
      throw new Error('Skill name is required');
    }
    if (!payload.entrypoint) {
      throw new Error('Skill entrypoint is required');
    }

    const result = await this.pool.query(
      `INSERT INTO skill_workflows (name, version, description, entrypoint, parameters)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name, version)
       DO UPDATE SET
         description = EXCLUDED.description,
         entrypoint = EXCLUDED.entrypoint,
         parameters = EXCLUDED.parameters,
         updated_at = NOW()
       RETURNING id, name, version, description, entrypoint, parameters, created_at, updated_at`,
      [payload.name, payload.version, payload.description, payload.entrypoint, JSON.stringify(payload.parameters ?? {})]
    );

    return this.mapWorkflow(result.rows[0]);
  }

  async recordRunReflection(input: SkillRunReflectionInput): Promise<SkillRunReflectionRecord> {
    const result = await this.pool.query(
      `INSERT INTO skill_run_reflections (skill_workflow_id, run_id, outcome, success, verification_payload, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, skill_workflow_id, run_id, outcome, success, verification_payload, latency_ms, created_at`,
      [
        input.skillWorkflowId,
        input.runId,
        input.outcome,
        input.success,
        input.verificationPayload ? JSON.stringify(input.verificationPayload) : null,
        input.latencyMs ?? null,
      ]
    );

    return this.mapRunReflection(result.rows[0]);
  }

  private mapWorkflow(row: any): SkillWorkflowRecord {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      description: row.description ?? null,
      entrypoint: row.entrypoint,
      parameters: coerceJson(row.parameters),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapRunReflection(row: any): SkillRunReflectionRecord {
    return {
      id: row.id,
      skillWorkflowId: row.skill_workflow_id,
      runId: row.run_id,
      outcome: row.outcome,
      success: row.success,
      verificationPayload: row.verification_payload ? coerceJson(row.verification_payload) : null,
      latencyMs: row.latency_ms ?? null,
      createdAt: new Date(row.created_at),
    };
  }
}

export type SkillWorkflowSummary = Pick<SkillWorkflowRecord, 'id' | 'name' | 'version' | 'description' | 'entrypoint' | 'parameters'>;
