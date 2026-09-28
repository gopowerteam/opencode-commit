import { existsSync, mkdirSync, rmSync } from "fs"

if (existsSync("dist")) rmSync("dist", { recursive: true })
mkdirSync("dist")

const result = await Bun.build({
	entrypoints: ["src/index.ts"],
	outdir: "dist",
	target: "bun",
	format: "esm",
	external: ["bun", "@opencode/plugin"],
	minify: true,
})

if (!result.success) {
	console.error("Build failed:")
	for (const log of result.logs) {
		console.error(log)
	}
	process.exit(1)
}

console.log(`Built ${result.outputs.length} files:`)
for (const output of result.outputs) {
	console.log(`  ${output.path} (${(output.size / 1024).toFixed(1)} KB)`)
}

const proc = Bun.spawn(["bunx", "tsc", "-p", "tsconfig.build.json"])
const exitCode = await proc.exited
if (exitCode !== 0) {
	console.error("DTS generation failed")
	process.exit(1)
}
console.log("Generated type declarations")
