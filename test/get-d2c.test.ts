import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extFromMime,
  decodeDataUrl,
  sanitizeResourceKey,
  splitResourceKey,
  replaceResourceRef,
  detectImageExt,
} from "../src/tools/get-d2c";

test("sanitizeResourceKey: 保留中文文件名", () => {
  assert.equal(
    sanitizeResourceKey("微信图片_20260803155147_1_1-7-75.jpg"),
    "微信图片_20260803155147_1_1-7-75.jpg"
  );
});

test("sanitizeResourceKey: 只清理路径分隔符与目录穿越段", () => {
  assert.equal(sanitizeResourceKey("../微信图片.jpg"), "微信图片.jpg");
  assert.equal(sanitizeResourceKey("a/./b.png"), "a/b.png");
  assert.equal(sanitizeResourceKey("a\\b.png"), "a/b.png");
});

test("splitResourceKey: 中文文件名 + 扩展名", () => {
  const withExt = splitResourceKey("微信图片_2026.jpg");
  assert.equal(withExt.stem, "微信图片_2026");
  assert.equal(withExt.ext, "jpg");

  const upperExt = splitResourceKey("微信图片_2026.JPG");
  assert.equal(upperExt.stem, "微信图片_2026");
  assert.equal(upperExt.ext, "jpg");

  const withoutExt = splitResourceKey("微信图片_2026");
  assert.equal(withoutExt.stem, "微信图片_2026");
  assert.equal(withoutExt.ext, undefined);
});

test("replaceResourceRef: 中文 key 替换为新的文件名，并保留目录前缀", () => {
  const code = `<img src="./asset/images/微信图片_2026.jpg" />`;
  assert.equal(
    replaceResourceRef(code, "微信图片_2026.jpg", "微信图片_2026.png"),
    `<img src="./asset/images/微信图片_2026.png" />`
  );
});

test("replaceResourceRef: 不误伤包含关系的前后字符", () => {
  const code = `<img src="./a.jpg" /><img src="./ba.jpg" />`;
  assert.equal(
    replaceResourceRef(code, "a.jpg", "a.png"),
    `<img src="./a.png" /><img src="./ba.jpg" />`
  );
});

test("extFromMime: 常见图片 MIME 映射", () => {
  assert.equal(extFromMime("image/png"), "png");
  assert.equal(extFromMime("image/jpeg"), "jpg");
  assert.equal(extFromMime("image/svg+xml; charset=utf-8"), "svg");
});

test("decodeDataUrl: 从 MIME 推断扩展名并解码 base64", () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const result = decodeDataUrl(`data:image/png;base64,${pngBytes.toString("base64")}`);
  assert.ok(result);
  assert.equal(result.ext, "png");
  assert.deepEqual(result.data, pngBytes);
});

test("detectImageExt: 识别 PNG / JPEG 魔数", () => {
  assert.equal(detectImageExt(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "png");
  assert.equal(detectImageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "jpg");
  assert.equal(detectImageExt(Buffer.from("hello")), undefined);
});
