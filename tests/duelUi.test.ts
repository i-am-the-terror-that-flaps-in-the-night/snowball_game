import { describe, expect, it } from 'vitest';
import { ROOM_CODE_CHARS, ROOM_CODE_LEN, cleanRoomCode } from '../src/ui/DuelUI';

describe('room codes', () => {
  it('upper-cases, strips ambiguous / foreign characters and clips to length', () => {
    expect(cleanRoomCode('k7qxm')).toBe('K7QXM');
    expect(cleanRoomCode(' k-7 q x m z z ')).toBe('K7QXM');
    expect(cleanRoomCode('O0I1L')).toBe('');
    expect(cleanRoomCode('ABCDEFGH')).toHaveLength(ROOM_CODE_LEN);
  });
  it('alphabet has no look-alike characters', () => {
    for (const ch of 'O0I1L') expect(ROOM_CODE_CHARS.includes(ch)).toBe(false);
  });
});
