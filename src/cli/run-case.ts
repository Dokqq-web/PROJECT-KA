import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { TestCase } from "../domain/test-case.js";
import { PlaywrightRunner } from "../runners/playwright-runner.js";

const inputPath = resolve(process.argv[2] ?? "examples/login.test-case.json");
const outputPath = resolve(process.argv[3] ?? "artifacts/latest-result.json");

const testCase = JSON.parse(await readFile(inputPath, "utf8")) as TestCase;
const runner = new PlaywrightRunner();
const result = await runner.run(testCase);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

console.log(`${result.status.toUpperCase()}: ${result.testCaseId}`);
console.log(`Report: ${outputPath}`);
process.exitCode = result.status === "passed" ? 0 : 1;

