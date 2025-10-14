import type { Pool } from 'pg';
import { AgentTaskFacade } from './AgentTaskFacade';
import { TaskService } from '../TaskService';

let newDb: any;
let pgMemAvailable = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ newDb } = require('pg-mem'));
} catch (error) {
  pgMemAvailable = false;
  console.warn('pg-mem is not available; skipping AgentTaskFacade integration tests.');
}

const setupDatabase = () => {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.none(`
    CREATE TABLE companies (
      id SERIAL PRIMARY KEY,
      name TEXT
    );

    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      username TEXT,
      email TEXT
    );

    CREATE TABLE agent_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(20) DEFAULT 'active'
    );

    CREATE TABLE agent_messages (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      content TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE tasks (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      priority VARCHAR(50),
      due_date TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by_agent BOOLEAN NOT NULL DEFAULT FALSE,
      agent_session_id INTEGER REFERENCES agent_sessions(id) ON DELETE SET NULL
    );

    CREATE TABLE task_assignments (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id, user_id)
    );

    CREATE TABLE task_participants (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(50) DEFAULT 'participant',
      is_watcher BOOLEAN DEFAULT FALSE,
      joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_read_at TIMESTAMPTZ,
      last_read_message_id INTEGER,
      notification_preference VARCHAR(50) DEFAULT 'app'
    );

    CREATE UNIQUE INDEX idx_task_participants_unique ON task_participants(task_id, user_id);

    CREATE TABLE task_messages (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      participant_id INTEGER NOT NULL REFERENCES task_participants(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      is_system BOOLEAN DEFAULT FALSE,
      attachments JSONB DEFAULT '[]'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE agent_task_subscriptions (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      subscribed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      subscribed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_notified_status VARCHAR(50),
      last_notified_at TIMESTAMPTZ,
      last_notified_message_id INTEGER REFERENCES agent_messages(id) ON DELETE SET NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE (session_id, task_id)
    );
  `);
  return db;
};

describe('AgentTaskFacade integration', () => {
  if (!pgMemAvailable) {
    it.skip('skipped due to missing pg-mem dependency', () => {
      expect(true).toBe(true);
    });
    return;
  }

  const db = setupDatabase();
  const pg = db.adapters.createPg();
  const pool = new pg.Pool() as unknown as Pool;
  const facade = new AgentTaskFacade(pool);
  const taskService = new TaskService(pool);

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE agent_messages, agent_task_subscriptions, task_messages, task_participants, task_assignments, tasks, agent_sessions, users, companies RESTART IDENTITY CASCADE');
    await pool.query(`INSERT INTO companies (id, name) VALUES (1, 'Acme Corp')`);
    await pool.query(`INSERT INTO users (id, company_id, username, email) VALUES (1, 1, 'demo', 'demo@example.com')`);
    await pool.query(`INSERT INTO agent_sessions (id, user_id) VALUES (1, 1)`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates tasks via the facade and subscribes the session', async () => {
    const event = await facade.createTask(1, 1, 1, {
      title: 'Follow up with supplier',
      description: 'Check on the open purchase order',
    });

    expect(event.type).toBe('task_created');
    expect(event.task.createdByAgent).toBe(true);
    expect(event.task.agentSessionId).toBe(1);

    const taskRow = await pool.query('SELECT created_by_agent, agent_session_id FROM tasks WHERE id = $1', [event.task.id]);
    expect(taskRow.rows[0]).toMatchObject({ created_by_agent: true, agent_session_id: 1 });

    const subscription = await pool.query('SELECT session_id, task_id, last_notified_status FROM agent_task_subscriptions');
    expect(subscription.rows).toHaveLength(1);
    expect(subscription.rows[0]).toMatchObject({ session_id: 1, task_id: event.task.id, last_notified_status: 'pending' });

    const taskMessages = await pool.query('SELECT content, metadata, is_system FROM task_messages');
    expect(taskMessages.rows).toHaveLength(1);
    expect(taskMessages.rows[0].is_system).toBe(true);
    expect(taskMessages.rows[0].metadata.agent).toBe(true);
  });

  it('emits agent notifications when task status changes', async () => {
    const created = await facade.createTask(1, 1, 1, {
      title: 'Monitor inventory',
    });

    await taskService.updateTask(1, created.task.id, { status: 'in_progress' });

    const messages = await pool.query('SELECT role, content FROM agent_messages ORDER BY id ASC');
    expect(messages.rows).toHaveLength(1);
    const payload = JSON.parse(messages.rows[0].content);
    expect(payload.type).toBe('task_update');
    expect(payload.task.id).toBe(created.task.id);
    expect(payload.summary).toContain('is now');

    const subscription = await pool.query('SELECT last_notified_status FROM agent_task_subscriptions WHERE task_id = $1', [
      created.task.id,
    ]);
    expect(subscription.rows[0].last_notified_status).toBe('in_progress');
  });
});
