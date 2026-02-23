# Claudito Roadmap

## Progress Summary

- **Phase 1: GitHub Integration** ✅ Complete
- **Phase 2: Run Configurations** ✅ Complete
- **Phase 3: Docker Sandboxed Execution** 🔄 In Progress (3.1-3.4 backend done, UI remaining)
- **Phase 4: Slack Integration** 🔄 In Progress (4.1–4.4 done)
- **Phase 5: Advanced Agent Orchestration** 🔄 Not Started
- **Phase 6: Collaboration & Sharing** 🔄 Not Started
- **Phase 7: Observability & Analytics** 🔄 Not Started
- **Phase 8: Notification Hub & Webhooks** 🔄 Not Started

---

## Phase 1: GitHub Integration (via GitHub CLI)

Integrate with GitHub using the `gh` CLI tool to browse repositories, clone projects, and work on issues directly from the Claudito UI. Requires `gh` to be installed and authenticated on the host machine.

### Milestone 1.1: GitHub CLI Detection & Service Layer

- [x] Create `GitHubCLIService` interface wrapping `gh` CLI commands via `child_process`
- [x] Implement `gh` availability detection (`gh --version`) with clear error messaging when missing
- [x] Detect authentication status via `gh auth status` and surface login instructions in Settings UI
- [x] Add `GET /api/integrations/github/status` endpoint returning CLI version and auth state
- [x] Add GitHub connection status indicator in Settings UI (installed, authenticated, username/org)

### Milestone 1.2: Repository Browser & Project Import

- [x] Add `GET /api/integrations/github/repos` endpoint using `gh repo list` with owner/type/language filters
- [x] Create repository browser modal with org/user filtering, search (`gh search repos`), and sorting
- [x] Implement `POST /api/integrations/github/clone` using `gh repo clone` and register as Claudito project
- [x] Support selecting target directory and branch during clone (`gh repo clone -- --branch`)
- [x] Show clone progress via WebSocket events (`github_clone_progress`) by streaming `gh` stdout

### Milestone 1.3: GitHub Issues Integration

- [x] Add `GET /api/integrations/github/issues` endpoint using `gh issue list` with JSON output (`--json`)
- [x] Create issues panel in project view with label/milestone/assignee filters via `gh issue list --label --milestone --assignee`
- [x] Implement "Start Working" action: fetch issue detail via `gh issue view --json` and generate agent prompt from body and comments
- [x] Implement "Add to Roadmap" action: convert issue into roadmap task with `gh` issue URL link back
- [x] Sync issue status via `gh issue close` on task completion and `gh issue comment` for progress updates

### Milestone 1.4: Pull Request Workflow

- [x] Add `POST /api/integrations/github/pr` using `gh pr create` from current branch with title and body
- [x] Auto-generate PR title and description from conversation history and diff
- [x] Fetch PR review comments via `gh pr view --json reviews,comments` and show in agent output tab
- [x] Add "Fix PR Feedback" action: parse review comments from `gh pr diff` and feed as agent prompt

### Milestone 1.5: GitHub Issue Creation

- [x] Define `IssueCreateOptions` interface with fields: `repo`, `title`, `body`, `labels` (string array), `assignees` (string array), `milestone` (string)
- [x] Add `createIssue(options: IssueCreateOptions)` method to `GitHubCLIService` interface and implement it using `gh issue create --repo --title --body [--label --assignee --milestone]`
- [x] Add `POST /api/integrations/github/issues` endpoint that validates required fields (`title`, `body`) and calls `createIssue`, returning the created issue URL and number
- [x] Create "New Issue" button in the GitHub Issues panel that opens a creation modal with title input, body textarea (markdown), label multi-select, assignee multi-select, and milestone dropdown
- [x] Populate label, assignee, and milestone dropdowns by fetching available options via `gh label list`, `gh api repos/:owner/:repo/collaborators`, and `gh api repos/:owner/:repo/milestones`
- [x] Add unit tests for the `createIssue` service method, the POST route handler, and arg-building logic

## Phase 2: Run Configurations

Allow users to define, manage, and execute named run configurations per project — similar to JetBrains IDE run/debug configurations. Each configuration defines a shell command (with optional arguments, environment variables, and working directory) that can be launched, stopped, and monitored from the UI.

### Milestone 2.1: Run Configuration Data Model & Persistence

- [x] Define `RunConfiguration` interface with fields: `id`, `name`, `command`, `args`, `cwd` (relative to project root), `env` (key-value pairs), `shell` (optional override), `autoRestart` (boolean), `preLaunchConfigId` (optional, references another config to run first)
- [x] Add `runConfigurations` array to the project `status.json` schema with CRUD operations in `ProjectRepository`
- [x] Create `RunConfigurationService` interface with methods: `create`, `update`, `delete`, `getAll`, `getById`
- [x] Implement `DefaultRunConfigurationService` with validation (unique names, command required, valid cwd path)
- [x] Add unit tests for the service covering CRUD, validation errors, and pre-launch dependency cycles

### Milestone 2.2: Run Configuration API Endpoints

- [x] Add `GET /api/projects/:id/run-configs` returning all configurations for a project
- [x] Add `POST /api/projects/:id/run-configs` to create a new configuration (validate required fields)
- [x] Add `PUT /api/projects/:id/run-configs/:configId` to update an existing configuration
- [x] Add `DELETE /api/projects/:id/run-configs/:configId` to remove a configuration (prevent deletion if referenced as pre-launch by another config)
- [x] Add unit tests for all route handlers with mocked service layer

### Milestone 2.3: Process Execution & Lifecycle

- [x] Create `RunProcessManager` interface for spawning and tracking running processes per project
- [x] Implement process spawning via `node-pty` with configured `command`, `args`, `cwd`, `env`, and `shell` options
- [x] Handle pre-launch chains: before starting a config, start its `preLaunchConfigId` config first and wait for it to be running
- [x] Add `POST /api/projects/:id/run-configs/:configId/start` and `POST .../stop` endpoints
- [x] Add `GET /api/projects/:id/run-configs/:configId/status` returning process state (`stopped`, `starting`, `running`, `errored`), PID, uptime, and exit code
- [x] Implement graceful stop and auto-restart on crash when `autoRestart` is enabled

### Milestone 2.4: Real-Time Output Streaming & UI

- [x] Stream process stdout/stderr to the frontend via WebSocket events (`run_config_output`, `run_config_status`)
- [x] Create a "Run Configurations" panel in the project view with a list of all configs showing name, status badge, and start/stop buttons
- [x] Add a run configuration editor modal with form fields for name, command, args, cwd, env variables (dynamic key-value rows), shell, auto-restart toggle, and pre-launch config dropdown
- [x] Implement a terminal-style output viewer per running config (xterm.js with ANSI color support, clear button)
- [x] Add import from project files (package.json, Cargo.toml, go.mod, Makefile, pyproject.toml) via `RunConfigImportService`
- [x] Support running multiple configs simultaneously with independent output streams and status tracking

## Phase 3: Docker Sandboxed Execution

Run Claude Code agents inside Docker containers with the project directory mounted, eliminating risk of unintended host modifications.

### Milestone 3.1: Docker Runtime Configuration

- [x] Create `DockerService` interface for container lifecycle management
- [x] Add Docker settings in UI: enable/disable, base image, resource limits (CPU, memory)
- [x] Implement Docker availability detection with fallback to host execution
- [x] Create `Dockerfile.claudito-agent` with Claude Code CLI, Node.js, and common dev tools
- [x] Add Docker settings to existing `GET/PUT /api/settings` endpoints with validation

### Milestone 3.2: Container Lifecycle Management

- [x] Implement container creation with project directory bind-mount (read-write)
- [x] Pass environment variables, Git config, and SSH keys into container securely
- [x] Implement container start/stop/restart aligned with agent lifecycle
- [x] Add container health checks and automatic restart on crash
- [x] Track container resource usage and expose via `GET /api/agents/containers`

### Milestone 3.3: Sandboxed Agent Execution

- [x] Modify `ClaudeAgent` to optionally spawn inside Docker container via `docker exec`
- [x] Stream agent stdout/stderr from container through existing WebSocket pipeline
- [x] Implement file sync strategy for `.claudito/` metadata (conversations, status)
- [x] Add per-project Docker override (some projects sandboxed, others on host)
- [x] Create network isolation options (no network, host network, custom bridge)

### Milestone 3.4: Docker Image Management

- [x] Add UI for managing custom agent images (list, build, remove)
- [x] Support per-project Dockerfile for project-specific toolchains
- [x] Implement image layer caching for fast container startup
- [x] Add pre-built image variants (Node.js, Python, Rust, Go, Java)

## Phase 4: Slack Integration

Integrate with Slack to send agent notifications, receive commands, and share project updates directly from Slack channels. Uses the Slack Web API and Socket Mode for real-time communication without requiring a public-facing server.

### Milestone 4.1: Slack App Configuration & Service Layer

- [x] Create `SlackService` interface wrapping Slack Web API calls (`@slack/web-api`) for messaging, channels, and user lookup
- [x] Create `SlackSocketService` interface wrapping Slack Socket Mode (`@slack/socket-mode`) for receiving slash commands and interactive events
- [x] Add Slack settings in Settings UI: Bot Token, App Token, default notification channel, enable/disable toggle
- [x] Add `GET /api/integrations/slack/status` endpoint returning connection state, workspace name, and bot user info
- [x] Implement token validation on save (call `auth.test`) with clear error messages for invalid or insufficient scopes
- [x] Add unit tests for `SlackService` methods with mocked API responses

### Milestone 4.2: Agent Event Notifications

- [x] Define `SlackNotificationConfig` interface with fields: `channelId`, `events` (array of event types to notify on), `mentionUsers` (array of Slack user IDs), `threadReplies` (boolean)
- [x] Add per-project Slack notification settings in project settings UI with channel picker and event type checkboxes
- [x] Send Slack messages on key agent events: task completed, task failed, agent waiting for input, Ralph Loop iteration complete
- [x] Format notifications as rich Slack Block Kit messages with project name, task summary, status badge, and "Open in Claudito" link
- [x] Support thread-based updates: first notification creates a thread, subsequent events for the same task reply in-thread
- [x] Add unit tests for notification formatting and event-to-channel routing logic

### Milestone 4.3: Slash Commands & Interactive Actions

- [x] Register `/claudito` slash command handler via Socket Mode to accept commands like `/claudito status`, `/claudito start <project> <prompt>`, `/claudito stop <project>`
- [x] Implement `/claudito status` returning a summary of all running agents across projects with inline action buttons
- [x] Implement `/claudito start <project> <prompt>` to start an agent session from Slack, streaming key events back as thread replies
- [x] Add interactive button actions on notifications: "Stop Agent", "View Conversation", "Approve" / "Reject" (for plan mode)
- [x] Handle Slack acknowledgement timeouts correctly (respond within 3s, use `response_url` for deferred replies)

### Milestone 4.4: Channel-Based Project Feeds

- [x] Add `POST /api/integrations/slack/link` to associate a Slack channel with a Claudito project (stored in project `status.json`)
- [x] Implement automatic posting of conversation summaries to linked channels when agent sessions complete
- [x] Post roadmap progress updates (milestone completion, phase transitions) to linked channels with progress bar visualization
- [x] Add `/claudito link` and `/claudito unlink` slash commands to manage channel-project associations from Slack
- [x] Include conversation statistics (duration, messages, tool calls, tokens) in completion summaries

## Phase 5: Advanced Agent Orchestration

Coordinate multiple Claude agents working on related tasks with dependency awareness, shared context, and parallel execution strategies.

### Milestone 5.1: Agent Pipeline Definition

- [ ] Define `AgentPipeline` interface with fields: `id`, `name`, `steps` (ordered array of `PipelineStep`), `parallelGroups` (steps that can run concurrently), `failureStrategy` (`stop-all` | `continue` | `retry`)
- [ ] Create `PipelineStep` interface with fields: `id`, `prompt`, `model`, `dependsOn` (array of step IDs), `outputMapping` (how to pass results to dependent steps)
- [ ] Implement `PipelineService` with methods: `create`, `start`, `stop`, `getStatus`, `getStepOutput`
- [ ] Add pipeline persistence in project `status.json` alongside run configurations
- [ ] Add unit tests for dependency resolution, cycle detection, and parallel group validation

### Milestone 5.2: Parallel Execution & Dependency Resolution

- [ ] Implement a DAG-based scheduler that resolves step dependencies and launches independent steps in parallel
- [ ] Enforce `maxConcurrentAgents` limit across pipelines and standalone agents using a shared semaphore
- [ ] Pass output from completed steps to dependent steps via prompt injection (append prior step's conversation summary)
- [ ] Handle step failures according to `failureStrategy`: propagate cancellation to dependent steps on `stop-all`, skip dependents on `continue`
- [ ] Stream per-step status updates via WebSocket events (`pipeline_step_status`, `pipeline_complete`)

### Milestone 5.3: Pipeline UI & Management

- [ ] Create a "Pipelines" tab in the project view with a visual DAG graph showing steps, dependencies, and live status
- [ ] Add pipeline editor modal with drag-and-drop step ordering, dependency wiring, and per-step prompt/model configuration
- [ ] Show real-time step output in expandable panels within the pipeline view
- [ ] Implement pipeline templates: save a pipeline as a reusable template and instantiate it on other projects
- [ ] Add pipeline history view showing past runs with duration, step outcomes, and token usage per step

## Phase 6: Collaboration & Sharing

Enable multiple users to work with the same Claudito instance, share projects, and collaborate on agent sessions in real-time.

### Milestone 6.1: User Identity & Authentication

- [ ] Add optional authentication layer with local username/password accounts stored in `$HOME/.claudito/users.json` (bcrypt-hashed passwords)
- [ ] Implement JWT-based session tokens issued on login with configurable expiry
- [ ] Add `GET/POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` endpoints
- [ ] Create login page UI with username/password form and "remember me" option
- [ ] Support running in "single-user" mode (no auth, current behavior) vs "multi-user" mode via settings toggle

### Milestone 6.2: Project Access Control

- [ ] Add `owner` and `collaborators` fields to project metadata in `index.json`
- [ ] Implement per-project role-based access: `owner` (full control), `editor` (read/write, start agents), `viewer` (read-only)
- [ ] Add project sharing UI: invite collaborators by username, assign roles, revoke access
- [ ] Enforce access control in route middleware — reject unauthorized project operations with 403
- [ ] Add unit tests for authorization middleware across all project routes

### Milestone 6.3: Real-Time Collaborative Sessions

- [ ] Extend WebSocket server to track connected users per project and broadcast presence indicators
- [ ] Show active user avatars/initials in the project header with "currently viewing" status
- [ ] Implement shared agent input: multiple users can see and contribute to the same agent conversation
- [ ] Add user attribution to conversation messages (who sent each prompt) displayed in the agent output tab
- [ ] Implement cursor/scroll position sharing so collaborators can see where others are looking in the conversation

## Phase 7: Observability & Analytics

Provide deep visibility into agent behavior, resource consumption, and project health through dashboards, logs, and metrics.

### Milestone 7.1: Structured Logging & Log Viewer

- [ ] Extend `Logger` to emit structured JSON log entries with fields: `timestamp`, `level`, `component`, `projectId`, `agentId`, `message`, `metadata`
- [ ] Persist logs to per-project log files in `{project-root}/.claudito/logs/` with daily rotation and configurable retention (default: 7 days)
- [ ] Create `GET /api/projects/:id/logs` endpoint with query params: `level`, `component`, `from`, `to`, `search`, `limit`, `offset`
- [ ] Build a log viewer UI tab with real-time streaming, level-based filtering (debug/info/warn/error), and full-text search
- [ ] Add log export functionality (download as JSON or CSV)

### Milestone 7.2: Token Usage & Cost Tracking

- [ ] Track token usage per agent session (input tokens, output tokens, cache read/write) with model-specific cost multipliers
- [ ] Store cumulative token usage per project and globally in `$HOME/.claudito/usage.json` with daily and monthly aggregation
- [ ] Create `GET /api/analytics/usage` endpoint returning usage data with filters: project, date range, model
- [ ] Build a usage dashboard UI with charts: daily token consumption (bar chart), cost by project (pie chart), model usage distribution
- [ ] Add configurable usage alerts: warn when daily/monthly token spend exceeds a threshold (displayed as banner + optional Slack notification)

### Milestone 7.3: Agent Performance Metrics

- [ ] Collect per-session metrics: total duration, time-to-first-response, tool call counts by type, retry counts, error rates
- [ ] Track Ralph Loop metrics: average iterations to approval, reviewer rejection rate, most common rejection reasons
- [ ] Create `GET /api/analytics/metrics` endpoint with aggregation options (per-project, per-model, per-time-period)
- [ ] Build a metrics dashboard with charts: session duration trends, tool usage heatmap, success/failure rates over time
- [ ] Add project health score combining metrics (success rate, average iterations, token efficiency) displayed on the project list

### Milestone 7.4: Conversation Insights

- [ ] Implement conversation summarization: auto-generate a brief summary when an agent session completes using a fast model
- [ ] Add tagging and search across conversations: tag conversations with labels, search by content or summary
- [ ] Create a "Knowledge Base" view that indexes tool outputs (file edits, search results) across conversations for a project
- [ ] Build a timeline view showing all project activity (agent sessions, roadmap changes, git commits) in chronological order
- [ ] Export conversation data as structured JSON for external analysis or backup

## Phase 8: Notification Hub & Webhooks

Provide a unified notification system with support for outgoing webhooks, enabling integration with any external service beyond Slack.

### Milestone 8.1: Notification Engine & Event Bus

- [ ] Create `NotificationService` interface with methods: `send`, `getHistory`, `markRead`, `configureChannel`
- [ ] Define `NotificationEvent` enum covering all emittable events: `agent.completed`, `agent.failed`, `agent.waiting`, `ralph.approved`, `ralph.rejected`, `roadmap.milestone_complete`, `pipeline.step_complete`
- [ ] Implement in-app notification storage in `$HOME/.claudito/notifications.json` with per-user read/unread state
- [ ] Add `GET /api/notifications` (with `?unread=true` filter), `POST /api/notifications/:id/read`, `POST /api/notifications/read-all` endpoints
- [ ] Build notification bell icon in the UI header with unread badge count and dropdown panel showing recent notifications

### Milestone 8.2: Outgoing Webhooks

- [ ] Define `WebhookConfig` interface with fields: `id`, `url`, `secret` (for HMAC signature), `events` (array of `NotificationEvent`), `enabled`, `retryPolicy` (`maxRetries`, `backoffMs`)
- [ ] Create `WebhookService` interface with methods: `create`, `update`, `delete`, `list`, `test`, `getDeliveryLog`
- [ ] Implement webhook delivery with HMAC-SHA256 signature in `X-Claudito-Signature` header, JSON payload, and retry with exponential backoff
- [ ] Add `POST /api/webhooks`, `PUT /api/webhooks/:id`, `DELETE /api/webhooks/:id`, `POST /api/webhooks/:id/test` endpoints
- [ ] Build webhook management UI in Settings: add/edit/delete webhooks, select events, view delivery log with status codes and response times
- [ ] Add unit tests for HMAC signing, retry logic, and payload formatting

### Milestone 8.3: Email Notifications

- [ ] Create `EmailNotificationService` interface wrapping `nodemailer` for sending HTML emails via SMTP
- [ ] Add email settings in Settings UI: SMTP host, port, username, password, from address, enable/disable toggle
- [ ] Implement email notification templates using HTML with inline CSS for: task completion summary, agent error alert, daily digest
- [ ] Add per-project email recipient configuration with event type filtering (same model as Slack notifications)
- [ ] Implement daily digest email: aggregate all project activity from the past 24 hours into a single summary email sent at a configurable time

### Milestone 8.4: Discord Integration

- [ ] Create `DiscordService` interface wrapping Discord webhook URLs for sending rich embed messages
- [ ] Add Discord webhook URL configuration in Settings UI with per-project channel override support
- [ ] Format notifications as Discord embeds with color-coded status (green=success, red=failure, yellow=waiting), project name, and task details
- [ ] Implement `/claudito` Discord bot commands via Discord Interactions API: `status`, `start`, `stop` (mirroring Slack slash commands)
- [ ] Support Discord thread creation for multi-event task tracking (similar to Slack thread-based updates)
