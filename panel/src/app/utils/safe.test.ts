import assert from "assert";
import { checkSafeName } from "./safe";

assert.strictEqual(checkSafeName("abc_DEF-123"), true);
assert.strictEqual(checkSafeName(""), false);
assert.strictEqual(checkSafeName("   "), false);
assert.strictEqual(checkSafeName("abc/../def"), false);
