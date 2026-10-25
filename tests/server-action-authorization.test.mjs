import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

async function load(file, actor = 'owner') {
  const state = {
    profiles: [{ userId: 'owner', membership: 'free' }, { userId: 'other', membership: 'pro' }],
    todos: [{ id: 'mine', userId: 'owner', content: 'mine', completed: false }, { id: 'victim', userId: 'other', content: 'secret', completed: false }],
    operations: 0,
  };
  const table = (name, fields) => Object.assign({ table: name }, Object.fromEntries(fields.map((field) => [field, field])));
  const profilesTable = table('profiles', ['userId', 'membership', 'stripeCustomerId']);
  const todosTable = table('todos', ['id', 'userId', 'content', 'completed']);
  const db = {
    insert: (table) => ({ values: (data) => ({ returning: async () => {
      state.operations += 1;
      const row = { ...(table === profilesTable ? { membership: 'free' } : {}), ...data };
      state[table.table].push(row);
      return [row];
    } }) }),
    update: (table) => ({ set: (changes) => ({ where: (predicate) => ({ returning: async () => {
      state.operations += 1;
      const rows = state[table.table].filter(predicate);
      for (const row of rows) Object.assign(row, changes);
      return rows;
    } }) }) }),
    delete: (table) => ({ where: async (predicate) => {
      state.operations += 1;
      state[table.table] = state[table.table].filter((row) => !predicate(row));
    } }),
    query: {
      profiles: { findFirst: async ({ where }) => state.profiles.find(where) },
      todos: { findMany: async ({ where }) => state.todos.filter(where) },
    },
  };
  const exports = {
    db, profilesTable, todosTable,
    auth: async () => ({ userId: actor }),
    eq: (column, value) => (row) => row[column] === value,
    and: (...predicates) => (row) => predicates.every((predicate) => predicate(row)),
    InsertProfile: undefined, SelectProfile: undefined, InsertTodo: undefined,
    SelectTodo: undefined, ActionState: undefined,
  };
  const context = vm.createContext({ console });
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context });
  await module.link(() => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { context }));
  await module.evaluate();
  return { api: module.namespace, state, source };
}

test('profile actions reject anonymous and cross-user access before DB mutation', async () => {
  for (const actor of [null, 'owner']) {
    const { api, state } = await load('actions/db/profiles-actions.ts', actor);
    assert.equal((await api.createProfileAction({ userId: 'other' })).isSuccess, false);
    assert.equal((await api.getProfileByUserIdAction('other')).isSuccess, false);
    assert.equal((await api.deleteProfileAction('other')).isSuccess, false);
    assert.equal(state.operations, 0);
  }
});

test('profile creation cannot set membership or Stripe privilege fields', async () => {
  for (const fields of [{ membership: 'pro' }, { stripeCustomerId: 'attacker' }, { stripeSubscriptionId: 'sub' }, { createdAt: new Date() }]) {
    const { api, state } = await load('actions/db/profiles-actions.ts');
    assert.equal((await api.createProfileAction({ userId: 'owner', ...fields })).isSuccess, false);
    assert.equal(state.operations, 0);
  }
});

test('profile actions preserve self-service creation, read and deletion', async () => {
  const { api, state } = await load('actions/db/profiles-actions.ts');
  assert.equal((await api.createProfileAction({ userId: 'owner' })).data.membership, 'free');
  assert.equal((await api.getProfileByUserIdAction('owner')).data.userId, 'owner');
  assert.equal((await api.deleteProfileAction('owner')).isSuccess, true);
  assert.equal(state.profiles.length, 1);
  assert.equal(state.profiles[0].userId, 'other');
});

test('billing writers are absent from externally invocable profile action exports', async () => {
  const { api } = await load('actions/db/profiles-actions.ts');
  assert.equal(api.updateProfileAction, undefined);
  assert.equal(api.updateProfileByStripeCustomerIdAction, undefined);
  const { api: billing, source } = await load('lib/server/profile-billing.ts', null);
  assert.match(source, /import "server-only"/);
  assert.doesNotMatch(source, /["']use server["']/);
  assert.equal((await billing.updateProfileAction('owner', { membership: 'pro' })).data.membership, 'pro');
});

if ((await readFile(new URL('../package.json', import.meta.url), 'utf8')).includes('mckays-app-template')) {
  test('todo actions bind writes to the actor and reject ownership transfer', async () => {
    const { api, state } = await load('actions/db/todos-actions.ts');
    assert.equal((await api.createTodoAction({ userId: 'other', content: 'bad' })).isSuccess, false);
    assert.equal((await api.getTodosAction('other')).isSuccess, false);
    assert.equal((await api.updateTodoAction('mine', { userId: 'other', completed: true })).isSuccess, false);
    await api.updateTodoAction('victim', { content: 'attack' });
    await api.deleteTodoAction('victim');
    assert.equal(state.todos.find((row) => row.id === 'victim').content, 'secret');
    await api.updateTodoAction('mine', { completed: true });
    assert.equal(state.todos.find((row) => row.id === 'mine').completed, true);
    assert.equal((await api.createTodoAction({ userId: 'owner', content: 'new' })).data.userId, 'owner');
    assert.equal((await api.getTodosAction('owner')).data.length, 2);
    await api.deleteTodoAction('mine');
    assert.equal(state.todos.some((row) => row.id === 'mine'), false);
  });

  test('unauthenticated todo calls perform no writes', async () => {
    const { api, state } = await load('actions/db/todos-actions.ts', null);
    assert.equal((await api.createTodoAction({ userId: 'owner', content: 'bad' })).isSuccess, false);
    assert.equal((await api.getTodosAction('owner')).isSuccess, false);
    assert.equal((await api.updateTodoAction('mine', { completed: true })).isSuccess, false);
    assert.equal((await api.deleteTodoAction('mine')).isSuccess, false);
    assert.equal(state.operations, 0);
  });
}
