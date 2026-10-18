import test from 'node:test';
import assert from 'node:assert/strict';
import { creationFields, inspectWorkItemSchema } from './verify-azure-schema.mjs';

test('accepts a complete Azure work item type with required states', () => {
  const result = inspectWorkItemSchema(
    { name: '3in1 Task', states: [{ name: 'New' }, { name: 'Closed' }] },
    { value: creationFields.map(referenceName => ({ referenceName })) }
  );
  assert.equal(result.compatible, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.missingStates, []);
});
test('detects missing fields and workflow states', () => {
  const result = inspectWorkItemSchema(
    { name: '3in1 Task', states: [{ name: 'New' }, { name: 'Active' }] },
    { value: creationFields.filter(x => x !== 'Custom.GenAIEnabled')
      .map(referenceName => ({ referenceName })) }
  );
  assert.equal(result.compatible, false);
  assert.deepEqual(result.missing, ['Custom.GenAIEnabled']);
  assert.deepEqual(result.missingStates, ['Closed']);
});
test('rejects malformed Azure responses rather than claiming success', () => {
  assert.throws(() => inspectWorkItemSchema({ name: '3in1 Task' }, {}), /incomplete/);
});
