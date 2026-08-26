import { assertEquals } from "@std/assert";
import { name } from "../src/cli-status-line.ts";

Deno.test("sanity check", () => {
	assertEquals(name(), "it works");
});
