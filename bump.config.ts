import { defineConfig } from 'bumpp'

export default defineConfig({
  commit: 'chore: release v%s',
  // 打 v 前缀 tag 并推送，触发 GitHub Actions 自动测试 + 发布到 npm
  tag: 'v%s',
  push: true,
})
