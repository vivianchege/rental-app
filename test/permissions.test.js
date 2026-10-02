import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessWorkspaceRecord } from '../src/lib/permissions.js';

test('workspace records are limited to the active workspace', () => {
  assert.equal(canAccessWorkspaceRecord({ workspaceId: 'workspace-a' }, 'workspace-a'), true);
  assert.equal(canAccessWorkspaceRecord({ workspaceId: 'workspace-b' }, 'workspace-a'), false);
});

test('legacy accounts can reset legacy records but not another workspace', () => {
  assert.equal(canAccessWorkspaceRecord({}, 'main-workspace', true), true);
  assert.equal(canAccessWorkspaceRecord({ workspaceId: 'main-workspace' }, 'main-workspace', true), true);
  assert.equal(canAccessWorkspaceRecord({ workspaceId: 'workspace-b' }, 'main-workspace', true), false);
});

test('non-legacy accounts cannot update records without workspace ownership', () => {
  assert.equal(canAccessWorkspaceRecord({}, 'workspace-a'), false);
});
