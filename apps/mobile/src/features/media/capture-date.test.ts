import { describe, expect, test, vi } from 'vitest';

vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
}));
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-location', () => ({}));
vi.mock('expo-media-library/legacy', () => ({}));
vi.mock('expo-sharing', () => ({}));
vi.mock('react-native', () => ({
  Alert: {
    alert: vi.fn(),
  },
}));
vi.mock('react-native-compressor', () => ({
  Image: {
    compress: vi.fn(),
  },
  createVideoThumbnail: vi.fn(),
  getRealPath: vi.fn(),
}));

import { readCapturedAtFromExif } from './client';

describe('captured date metadata', () => {
  test('parses common EXIF capture date formats', () => {
    expect(
      readCapturedAtFromExif({
        DateTimeOriginal: '2026:04:18 09:30:05',
      }),
    ).toBe(Date.parse('2026-04-18T09:30:05'));
    expect(
      readCapturedAtFromExif({
        DateTimeDigitized: '2026-04-18T09:30:05.000Z',
      }),
    ).toBe(Date.parse('2026-04-18T09:30:05.000Z'));
  });

  test('ignores missing, invalid, and non-finite EXIF capture dates', () => {
    expect(readCapturedAtFromExif(null)).toBeUndefined();
    expect(readCapturedAtFromExif({ DateTimeOriginal: 'not a date' })).toBeUndefined();
    expect(readCapturedAtFromExif({ DateTimeOriginal: Number.NaN })).toBeUndefined();
  });
});
