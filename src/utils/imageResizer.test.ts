import { expect, test } from 'bun:test'
import {
  detectImageDimensionsFromBuffer,
  detectImageFormatFromBuffer,
  maybeResizeAndDownsampleImageBuffer,
} from './imageResizer.js'

test('detects PNG dimensions without an image processor', () => {
  const buffer = Buffer.alloc(24)
  buffer.set([0x89, 0x50, 0x4e, 0x47], 0)
  buffer.writeUInt32BE(3024, 16)
  buffer.writeUInt32BE(1964, 20)

  expect(detectImageFormatFromBuffer(buffer)).toBe('image/png')
  expect(detectImageDimensionsFromBuffer(buffer)).toEqual({
    width: 3024,
    height: 1964,
  })
})

test('detects JPEG dimensions without an image processor', () => {
  const buffer = Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    0x07,
    0xac,
    0x0b,
    0xd0,
  ])

  expect(detectImageFormatFromBuffer(buffer)).toBe('image/jpeg')
  expect(detectImageDimensionsFromBuffer(buffer)).toEqual({
    width: 3024,
    height: 1964,
  })
})

test('detects GIF dimensions without an image processor', () => {
  const buffer = Buffer.alloc(10)
  buffer.write('GIF89a', 0, 'ascii')
  buffer.writeUInt16LE(640, 6)
  buffer.writeUInt16LE(480, 8)

  expect(detectImageFormatFromBuffer(buffer)).toBe('image/gif')
  expect(detectImageDimensionsFromBuffer(buffer)).toEqual({
    width: 640,
    height: 480,
  })
})

test('forwards an under-limit large image when no image processor is available', async () => {
  const buffer = Buffer.alloc(24)
  buffer.set([0x89, 0x50, 0x4e, 0x47], 0)
  buffer.writeUInt32BE(3024, 16)
  buffer.writeUInt32BE(1894, 20)

  const result = await maybeResizeAndDownsampleImageBuffer(
    buffer,
    buffer.length,
    'png',
  )

  expect(result.buffer).toEqual(buffer)
  expect(result.mediaType).toBe('png')
  expect(result.dimensions).toEqual({
    originalWidth: 3024,
    originalHeight: 1894,
    displayWidth: 3024,
    displayHeight: 1894,
  })
})
