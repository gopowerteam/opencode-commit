import { spawn } from 'bun'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const projectDir = dirname(dirname(import.meta.path))

console.log('Starting OpenCode with plugin loaded from source...')
console.log('')

// V2 的 plugins 条目要求插件目录（不能是单个文件路径）
const pluginPath = pathToFileURL(join(projectDir, 'src')).href
console.log(`Plugin path: ${pluginPath}`)

const config = { plugins: [pluginPath] }

const OPENCODE_CONFIG_CONTENT = JSON.stringify(config)

console.log(`OPENCODE_CONFIG_CONTENT='${OPENCODE_CONFIG_CONTENT}' opencode`)

const proc = spawn(['opencode'], {
	env: {
		...process.env,
		OPENCODE_CONFIG_CONTENT,
	},
	stdin: 'inherit',
	stdout: 'inherit',
	stderr: 'inherit',
})

await proc.exited
