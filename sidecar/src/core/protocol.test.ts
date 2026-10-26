import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION, parseClientMessage } from '../core/protocol.js';

describe('parseClientMessage', () => {
  it('accepts a valid project:open message', () => {
    const frame = JSON.stringify({
      v: PROTOCOL_VERSION,
      id: 'req-1',
      type: 'project:open',
      payload: { path: '/tmp/x.deepnote' },
    });
    const parsed = parseClientMessage(frame);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe('project:open');
  });

  it('rejects frames that are not JSON', () => {
    expect(parseClientMessage('not-json')).toBeNull();
  });

  it('rejects unknown protocol versions', () => {
    const frame = JSON.stringify({ v: 99, id: 'req-1', type: 'project:get' });
    expect(parseClientMessage(frame)).toBeNull();
  });

  it('rejects unknown message types', () => {
    const frame = JSON.stringify({ v: PROTOCOL_VERSION, id: 'req-1', type: 'evil:exec' });
    expect(parseClientMessage(frame)).toBeNull();
  });

  it('rejects messages without an id', () => {
    const frame = JSON.stringify({ v: PROTOCOL_VERSION, type: 'project:get' });
    expect(parseClientMessage(frame)).toBeNull();
  });

  it('accepts messages without a payload', () => {
    const frame = JSON.stringify({ v: PROTOCOL_VERSION, id: 'req-2', type: 'exec:stop' });
    expect(parseClientMessage(frame)?.type).toBe('exec:stop');
  });
});
