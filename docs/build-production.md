# 生产构建与部署

本文档已整合为**仓库内的 Agent Skill**（随仓库一起分发，所有支持该标准的 AI 工具共用）。**唯一权威来源**为：

→ [`.agents/skills/mcsmanager-build/SKILL.md`](../.agents/skills/mcsmanager-build/SKILL.md)

内容涵盖：`build.bat` / `build.sh` 构建流水线（`BUNDLE=1`）的详细说明、产物目录结构、`daemon/lib` 外部二进制文件、构建/部署/运行命令、成对数据迁移、敏感文件清单、部署后验证清单以及常见问题。

当你提到"构建 / 编译 / 打包 / 部署到生产环境 / Build"等关键词时，支持 Agent Skills 的 AI 工具（包括 opencode、Claude Code 等）会自动调用 `mcsmanager-build` skill；你也可以直接阅读上述文件。opencode 会沿项目路径自动发现 `.agents/skills/`（无需额外配置）。
