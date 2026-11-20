import test from 'node:test';
import assert from 'node:assert/strict';
import { roomDiffersFromStored } from '../admin/src/editor/room-state.mjs';

const p = (id, text, tunes) => ({ id, type: 'paragraph', data: { text }, ...(tunes ? { tunes } : {}) });

test('M3: room equal to the stored value (default tunes only) is not a change', () => {
  const stored = { blocks: [p('a', 'Stored')] };
  const room = {
    blocks: [
      p('a', 'Stored', {
        alignmentTune: { alignment: 'left' },
        textVariant: '',
        indentTune: { indentLevel: 0 },
      }),
    ],
  };
  assert.equal(roomDiffersFromStored(room, stored), false);
});

test('M3: unsaved text left in the room is a change', () => {
  assert.equal(
    roomDiffersFromStored({ blocks: [p('a', 'Stored one')] }, { blocks: [p('a', 'Stored')] }),
    true
  );
  assert.equal(
    roomDiffersFromStored({ blocks: [p('a', 'Stored'), p('b', 'New')] }, { blocks: [p('a', 'Stored')] }),
    true
  );
  assert.equal(
    roomDiffersFromStored(
      { blocks: [p('a', 'Stored', { alignmentTune: { alignment: 'center' } })] },
      { blocks: [p('a', 'Stored')] }
    ),
    true
  );
});

test('M3: an empty field and a room with one empty paragraph are equal', () => {
  assert.equal(roomDiffersFromStored({ blocks: [p('x', '')] }, null), false);
  assert.equal(roomDiffersFromStored({ blocks: [] }, { blocks: [] }), false);
});
