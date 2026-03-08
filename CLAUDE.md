# Claudito - Project Context

Claude Code intelligent agent manager - TypeScript HTTP server with jQuery + Tailwind.css UI. Features Ralph Loop iterative development pattern and roadmap-based automation.

## Project Structure

```
src/
  index.ts          # Entry point (config + server instantiation only)
  config/           # Configuration loading
  server/           # Express server + WebSocket integration
  routes/           # API route handlers
  services/         # Business logic (ProjectService, RoadmapParser, InstructionGenerator, ClaudeOptimizationService)
  repositories/     # Data persistence (Project, Conversation, Settings)
  agents/           # Agent management (Agent interface, ClaudeBinary, AnthropicSdkAgent, OpencodeAgent, AgentManager)
  websocket/        # WebSocket server for real-time updates
  utils/            # Logger, error handling, retry utilities
public/
  vendor/           # Third-party assets (jQuery, Tailwind - NO CDN)
  js/               # Frontend JavaScript with WebSocket client
  css/              # Custom styles
test/
  unit/             # Unit tests
doc/
  ROADMAP.md        # Project milestones
  MERMAID_EXAMPLES.md # Mermaid.js diagram examples and reference
```

## Data Storage Structure

Global data in `$HOME/.claudito/`:
```
projects/
  index.json                      # [{ id, name, path }] - project registry
settings.json                     # Global settings + agentPromptTemplate
```

Project-specific data in `{project-root}/.claudito/`:
```
status.json                       # ProjectStatus object
conversations/
  {conversationId}.json           # Conversation with messages
```

## Key Interfaces

- **Infrastructure**: `ConfigLoader`, `HttpServer`, `ProjectWebSocketServer`, `EventManager` (in-memory event bus), `Logger` (with circular buffer)
- **Data**: `ProjectRepository` (status.json per project), `ConversationRepository` (per project/item), `SettingsRepository` (global settings + agentPromptTemplate)
- **Services**: `ProjectService`, `FilesystemService`, `GitService` (simple-git), `GitHubCLIService` (gh CLI wrapper), `RoadmapParser`, `RoadmapGenerator`, `InstructionGenerator`, `ClaudeOptimizationService` (edits files directly via Edit tool), `DataWipeService` (factory reset — wipes all Claudito data), `RunConfigurationService` (CRUD for run configs), `RunConfigImportService` (detects project files and suggests configs), `RunProcessManager` (node-pty process lifecycle with auto-restart), `InventifyService` (project idea generator using one-off agent + Ralph Loop)
- **Docker**: `DockerService` (CLI wrapper), `DockerCommandRunner` (testable command execution), `DockerProcessSpawner` (implements `ProcessSpawner` for Docker exec), `ContainerManager` (per-project container lifecycle, returns `EnsureContainerResult` with restart detection), `ImageManager` (image CRUD + variants)
- **Agents**: `Agent` (provider-agnostic interface), `ClaudeBinary` (Claude CLI implementation), `AnthropicSdkAgent` (Vercel AI SDK implementation, chat-only), `AgentManager` (multi-agent lifecycle: interactive + one-off, profile-aware factory)

## API Endpoints

All project routes prefixed with `/api/projects/:id`. Standard REST verbs (GET/POST/PUT/DELETE).

**Global**: `GET /api/health` (includes `shellEnabled`), `GET /api/agents/status`, `GET|PUT /api/settings`, `GET /api/settings/models`, `POST /api/settings/wipe-all-data`

**Integrations** (`/api/integrations`): `GET github/status`, `GET github/repos(?owner=&language=&limit=)`, `GET github/repos/search(?query=&language=&sort=&limit=)`, `POST github/clone` (body: repo, targetDir, branch?, projectName?), `GET github/issues(?repo=&state=&label=&assignee=&milestone=&limit=)`, `GET github/issues/:num(?repo=)`, `POST github/issues` (body: repo, title, body?, labels?, assignees?, milestone?), `POST github/issues/:num/close(?repo=)`, `POST github/issues/:num/comment(?repo=)` (body: body), `GET github/labels(?repo=)`, `GET github/milestones(?repo=)`, `GET github/collaborators(?repo=)`, `POST github/pr` (body: repo, title, body, base?, draft?), `GET github/pulls(?repo=&state=&limit=)`, `GET github/pulls/:num(?repo=)`

**Filesystem** (`/api/fs`): `drives`, `browse?path=`, `browse-with-files?path=`, `read?path=`, `PUT write`, `DELETE delete`

**Projects**: CRUD on `/api/projects` + `/:id`

**Roadmap** (`/:id/roadmap`): GET (content+parsed), `POST generate`, PUT (modify), `POST respond`, `PUT next-item`, `POST task` (add task), DELETE `task|milestone|phase`

**Agent** (`/:id/agent`): `POST interactive` (start session), `POST send`, `POST answer` (AskUserQuestion tool_result), `POST stop`, GET `status|context|loop|queue`, DELETE `queue(/:index)`

**One-Off Agents** (`/:id/agent/oneoff/:oneOffId`): `POST send|stop`, GET `status|context`

**Conversations** (`/:id`): GET `conversation|conversations(?limit=N)`, `PUT conversations/:conversationId` (rename)

**Config** (`/:id`): GET/PUT `claude-files|permissions|model`, GET `optimizations|debug`

**Git** (`/:id/git`): `POST generate-pr-description` (auto-generate PR title/body from conversation + diff), `GET user-name`

**Ralph Loop** (`/:id/ralph-loop`): GET (list), `POST start`, `/:taskId` GET|DELETE, `/:taskId/stop|pause|resume`

**Run Configurations** (`/:id/run-configs`): GET / (list), GET `/importable` (scan project files), POST / (create), PUT `/:configId` (update), DELETE `/:configId`, POST `/:configId/start`, POST `/:configId/stop`, GET `/:configId/status`

**Docker** (`/api/docker`): `GET /availability`, `GET /containers` (list all), `GET /containers/:projectId`, `POST /containers/:projectId/restart`, `GET /images` (list), `POST /images/build` (body: variantName, imageName?), `DELETE /images/:name`, `GET /variants`

**Per-Project Docker** (`/:id`): GET/PUT `docker` (dockerOverride toggle + dockerImage selector)

**Agent Profiles** (`/:id`): GET/PUT `agent-profile` (per-project profile override). Global profiles stored in settings (`agentProfiles` array)

**Inventify** (`/api/projects/inventify`): `POST /start` (body: projectTypes[], themes[], languages?[], technologies?[], customPrompt?) — brainstorms 5 project ideas, `GET /ideas` — returns pending ideas, `POST /suggest-names` (body: selectedIndex) — suggests 5 project names for selected idea, `GET /name-suggestions` — returns pending name suggestions, `POST /select` (body: selectedIndex, projectName) — picks an idea + name and builds it (creates directory + plan, registers project, starts Ralph Loop), `GET /build-result` — returns `{newProjectId, projectName}` after build completes (polled by frontend)

## WebSocket Messages

**Core**: `subscribe`/`unsubscribe`, `agent_message`, `agent_status`, `agent_waiting` (includes version + optional askUserQuestion data), `queue_change`, `roadmap_message`, `session_recovery`, `github_clone_progress`

**Ralph Loop**: `ralph_loop_status` (idle/worker_running/reviewer_running/completed/failed/paused), `ralph_loop_iteration`, `ralph_loop_output`, `ralph_loop_complete`, `ralph_loop_worker_complete`, `ralph_loop_reviewer_complete`, `ralph_loop_error`

**One-Off Agents**: `oneoff_message`, `oneoff_status`, `oneoff_waiting` (includes oneOffId, isWaiting, version)

**Run Configurations**: `run_config_output` (configId, data), `run_config_status` (configId, status)

## Ralph Loop

Implements Geoffrey Huntley's "Ralph Wiggum technique" - an iterative worker/reviewer pattern:
1. **Worker Phase**: Executes task with fresh context each iteration
2. **Reviewer Phase**: Reviews worker output and provides structured feedback
3. **Decision**: Approve (complete), reject (iterate), or fail (stop)
4. **Configurable**: Max iterations, worker/reviewer models, custom prompts
5. **Real-time**: Live output streaming and progress tracking

## Commands & Configuration

- `npm run dev` - Development with hot reload
- `npm run build` - Build TypeScript
- `npm start` - Run production build
- `npm test` - Run tests

**Environment Variables**: `PORT` (3000), `HOST` (0.0.0.0), `NODE_ENV`, `LOG_LEVEL`, `MAX_CONCURRENT_AGENTS` (3), `DEV_MODE`/`CLAUDITO_DEV_MODE` (enables experimental features like Git tab)

## Permissions & Modes

**Runtime modes** (changeable via UI, restarts agent with same session):
- **Accept Edits** (default): Auto-approve file edits
- **Plan**: Review plan before execution. `ExitPlanMode` shows Approve ("yes") / Request Changes (user input) / Reject ("no")

**Global** (`claudePermissions`): `dangerouslySkipPermissions`, `defaultMode` ('acceptEdits'|'plan'), `allowRules`/`denyRules` arrays (format: `Tool` or `Tool(specifier)`, e.g. "Read", "Bash(npm run:*)")

**Per-project** (`permissionOverrides` in status.json): `enabled`, `allowRules`, `denyRules`, `defaultMode`

## Session Management

Sessions use UUID v4 IDs: `--session-id {uuid}` (new) or `--resume {uuid}` (existing). Permission mode changes queue until idle, then restart with 1s delay. Unrecognized sessions auto-create fresh conversation with new UUID. When Claude calls `EnterPlanMode`, agent auto-restarts in plan mode and sends "Continue" so work proceeds without manual intervention.

## Features

**Server**: Graceful shutdown (SIGINT/SIGTERM), PID tracking (`$HOME/.claudito/pids.json`, orphans killed on startup), conversation statistics (duration, messages, tool calls, tokens), context usage persistence

**UI Tabs**: Agent Output (conversation + tool usage) and Project Files (tree view, multi-tab editor, Ctrl+S save, delete files/folders)
- **One-Off Agent Sub-Tabs**: Full rendering per tab, per-tab input/toolbar (Tasks, Search, Permission Mode, Model, Font Size), direct file editing
- **Claude Files Modal**: Edit CLAUDE.md files (global/project), markdown preview, optimize via one-off agent
- **Roadmap Management**: Checkbox selection, "Run Selected" auto-generates prompts, delete tasks/milestones/phases
- **Ralph Loop Tab**: Start/Pause/Resume/Stop controls, live output streaming, history view
- **Run Configs Tab**: Per-project named shell commands with xterm.js output, auto-restart, pre-launch chains, environment variables, import from project files (package.json, Cargo.toml, go.mod, Makefile, pyproject.toml)
- **GitHub Import**: Browse/search repos via `gh` CLI, clone and register as project with progress streaming
- **GitHub Issues**: Browse issues with state/label/assignee filters, view detail with comments, create new issues (with labels, assignees, milestones), "Start Working" (generates agent prompt), "Add to Roadmap" (creates task in milestone), close issues, add comments
- **GitHub PRs**: Create PRs with auto-generated title/description (from conversation + diff), list PRs, view PR detail with reviews/comments, "Fix PR Feedback" (generates agent prompt from review feedback)
- **Inventify**: Project idea generator — select project types + themes, optionally languages + technologies + custom instructions, agent brainstorms 5 ideas, user picks one, then agent creates detailed plan + directory with `doc/plan.md`, registers as Claudito project, auto-starts Ralph Loop to build it
- **Folder Browser**: "New Folder" button to create directories inline while browsing
- **Other**: Conversation history (view/rename, configurable limit), debug modal, mobile-responsive layout, Settings Danger Zone (wipe all data)

## Settings

`maxConcurrentAgents` (1-10), `agentPromptTemplate`, `appendSystemPrompt` (restarts all agents on change), `sendWithCtrlEnter`, `historyLimit` (5-100, default: 25), `promptTemplates`, `defaultModel` (default: claude-sonnet-4-6), `chromeEnabled` (toggle in toolbar, passes `--chrome`/`--no-chrome` to agents), `inventifyFolder` (parent directory for generated projects), `agentProfiles` (array of `AgentProfile` — provider + runtime config, selectable per-project)

**Prompt Templates**: Reusable prompts (Settings > Templates). Syntax: `${type:name}` or `${type:name:options}`. Types: `text`, `textarea`, `select:opt1,opt2`, `checkbox`

## Mermaid.js Support

Mermaid diagrams in ` ```mermaid ` code blocks render automatically in messages and plan content (dark theme). Use `/mermaid` skill via the bundled plugin (`claudito-plugin` directory, load with `claude --plugin-dir ./claudito-plugin`). See `doc/MERMAID_EXAMPLES.md` for syntax reference.
