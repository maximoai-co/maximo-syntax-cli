import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  asImageFilePath,
  splitPastedFilePaths,
  tryReadImageFromPath,
} from "./imagePaste.js";

test("splits quoted and escaped image paths emitted by terminal drag/drop", () => {
  assert.deepEqual(
    splitPastedFilePaths(
      "'/Users/dev/Desktop/first image.png' /Users/dev/Desktop/second\\ image.webp"
    ),
    [
      "/Users/dev/Desktop/first image.png",
      "/Users/dev/Desktop/second image.webp",
    ]
  );
});

test("accepts file URLs emitted by terminal drag/drop", () => {
  assert.equal(
    asImageFilePath("file:///Users/dev/Desktop/first%20image.png"),
    "/Users/dev/Desktop/first image.png"
  );
});

test("reads a normal-size dragged image without requiring a bundled image processor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "maximo-image-paste-"));
  const imagePath = join(dir, "dragged image.png");
  // 1x1 PNG. Normal clipboard and drag/drop images should take the direct
  // attachment path when they already fit the API limits.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );

  try {
    writeFileSync(imagePath, png);
    const image = await tryReadImageFromPath(`'${imagePath}'`);
    assert.ok(image);
    assert.equal(image.mediaType, "image/png");
    assert.equal(image.dimensions?.originalWidth, 1);
    assert.equal(image.dimensions?.originalHeight, 1);
    assert.equal(Buffer.from(image.base64, "base64").length, png.length);
    assert.deepEqual(Buffer.from(image.base64, "base64"), png);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolves a basename-only VS Code image drop from Downloads", async () => {
  const filename = `maximo-image-paste-${Date.now()}.png`;
  const imagePath = join(process.env.HOME ?? "", "Downloads", filename);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );

  try {
    writeFileSync(imagePath, png);
    const image = await tryReadImageFromPath(filename);
    assert.ok(image);
    assert.equal(image.path, imagePath);
    assert.equal(image.sourcePath, imagePath);
    assert.equal(image.originalSizeBytes, png.length);
  } finally {
    rmSync(imagePath, { force: true });
  }
});
