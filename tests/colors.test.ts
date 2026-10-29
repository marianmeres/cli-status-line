import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { cyan, dim, isColor, yellow } from "../src/colors.ts";
import { statusLine } from "../src/status-line.ts";
import { makeFakeIo } from "./_fake-io.ts";

test("isColor: NO_COLOR unset → true", () => {
	const io = makeFakeIo();
	io.setEnv("NO_COLOR", undefined);
	assert.equal(isColor(io), true);
});

test('isColor: NO_COLOR="" counts as unset (no-color.org) → true', () => {
	assert.equal(isColor(makeFakeIo({ env: { NO_COLOR: "" } })), true);
});

test("isColor: NO_COLOR with any non-empty value → false", () => {
	for (const v of ["1", "0", "false", "yes"]) {
		assert.equal(
			isColor(makeFakeIo({ env: { NO_COLOR: v } })),
			false,
			`NO_COLOR=${v}`,
		);
	}
});

test("cyan / yellow / dim emit the SGR open + matching close codes", () => {
	assert.equal(cyan("a"), "\x1b[36ma\x1b[39m");
	assert.equal(yellow("a"), "\x1b[33ma\x1b[39m");
	assert.equal(dim("a"), "\x1b[2ma\x1b[22m");
});

test("statusLine: colour follows NO_COLOR through the io seam", () => {
	mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
	try {
		const coloured = makeFakeIo({ columns: 80 });
		coloured.setEnv("NO_COLOR", undefined);
		statusLine({ io: coloured, clock: false, frames: ["A"] }).stop({ clear: false });
		assert.equal(coloured.writes[0], "\r\x1b[36mA\x1b[39m\x1b[K");

		const plain = makeFakeIo({ columns: 80, env: { NO_COLOR: "1" } });
		statusLine({ io: plain, clock: false, frames: ["A"] }).stop({ clear: false });
		assert.equal(plain.writes[0], "\rA\x1b[K");
	} finally {
		mock.timers.reset();
	}
});
