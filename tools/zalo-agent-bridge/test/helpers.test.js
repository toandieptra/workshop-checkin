import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractMessageId, normalizeRecipient, safeUploadPath } from "../helpers.js";

const root = "/tmp/workshop-checkin-zalo-bridge-test";

test("maps CLI recipient name and IDs", () => {
  assert.deepEqual(normalizeRecipient({ "+84901234567": { uid: "123", displayName: "Alice" } }, "+84901234567"), {
    user_id: "123",
    thread_id: "123",
    thread_type: 0,
    recipient_name: "Alice",
    display_name: "Alice",
  });
});

test("extracts message ID from CLI result shapes", () => {
  assert.equal(extractMessageId({ message: { msgId: "m1" } }), "m1");
  assert.equal(extractMessageId({ msg_id: "m2" }), "m2");
  assert.equal(extractMessageId({}), null);
});

test("accepts only regular files below upload root", async (t) => {
  const outside = `${root}-outside.jpg`;
  await rm(root, { recursive: true, force: true });
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "nested", "ok.jpg"), "x");
  await writeFile(outside, "x");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  });

  assert.equal(await safeUploadPath(join(root, "nested", "ok.jpg"), root), await realpath(join(root, "nested", "ok.jpg")));
  await assert.rejects(safeUploadPath(join(root, "nested", "../ok.jpg"), root), /không tồn tại|ngoài/);
  await assert.rejects(safeUploadPath(outside, root), /ngoài/);
  await symlink("/tmp", join(root, "escape"));
  await assert.rejects(safeUploadPath(join(root, "escape", outside.slice(5)), root), /ngoài/);
});
