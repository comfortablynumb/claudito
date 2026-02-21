import { execFile, spawn, ChildProcess } from 'child_process';
import { GitHubCLIError } from '../utils/errors';

// ============================================================================
// Types
// ============================================================================

export interface GitHubCLIStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  username: string | null;
  error: string | null;
}

export interface GitHubRepo {
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  isPrivate: boolean;
  language: string | null;
  updatedAt: string;
  stargazerCount: number;
}

export interface RepoListOptions {
  owner?: string;
  type?: 'all' | 'owner' | 'fork' | 'member';
  language?: string;
  limit?: number;
}

export interface RepoSearchOptions {
  query: string;
  language?: string;
  sort?: 'stars' | 'forks' | 'updated';
  limit?: number;
}

export interface CloneOptions {
  repo: string;
  targetDir: string;
  branch?: string;
}

export interface CloneProgress {
  phase: 'cloning' | 'done' | 'error';
  message: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  author: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  createdAt: string;
  updatedAt: string;
  commentsCount: number;
}

export interface GitHubIssueComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface GitHubIssueDetail {
  issue: GitHubIssue;
  comments: GitHubIssueComment[];
}

export interface IssueListOptions {
  repo: string;
  state?: 'open' | 'closed' | 'all';
  label?: string;
  assignee?: string;
  milestone?: string;
  limit?: number;
}

export interface IssueViewOptions {
  repo: string;
  issueNumber: number;
}

export interface IssueCreateOptions {
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  milestone?: string;
}

export interface GitHubLabel {
  name: string;
  color: string;
  description: string;
}

export interface GitHubMilestone {
  title: string;
  number: number;
  state: string;
}

export interface GitHubCollaborator {
  login: string;
}

// Pull Request types

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  url: string;
  author: string;
  headBranch: string;
  baseBranch: string;
  labels: string[];
  reviewDecision: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubPRReview {
  author: string;
  state: string;
  body: string;
  submittedAt: string;
}

export interface GitHubPRComment {
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  createdAt: string;
}

export interface GitHubPRDetail {
  pr: GitHubPullRequest;
  reviews: GitHubPRReview[];
  comments: GitHubPRComment[];
}

export interface PRCreateOptions {
  repo: string;
  title: string;
  body: string;
  base?: string;
  head?: string;
  draft?: boolean;
  cwd?: string;
}

export interface PRListOptions {
  repo: string;
  state?: 'open' | 'closed' | 'merged' | 'all';
  limit?: number;
}

export interface PRViewOptions {
  repo: string;
  prNumber: number;
}

// ============================================================================
// Command Runner (for DI / testability)
// ============================================================================

export interface CommandRunnerOptions {
  cwd?: string;
}

export interface CommandRunner {
  exec(command: string, args: string[], options?: CommandRunnerOptions): Promise<{ stdout: string; stderr: string }>;
  spawn(command: string, args: string[], options?: CommandRunnerOptions): ChildProcess;
}

export class DefaultCommandRunner implements CommandRunner {
  exec(command: string, args: string[], options?: CommandRunnerOptions): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        command,
        args,
        { cwd: options?.cwd, encoding: 'utf-8' },
        (err, stdout, stderr) => {
          if (err) {
            reject(err);
          } else {
            resolve({ stdout, stderr });
          }
        },
      );

      // Unref so pending child processes don't keep the event loop alive
      // (safe in production since the HTTP server holds the loop open anyway)
      child.unref();
    });
  }

  spawn(command: string, args: string[], options?: CommandRunnerOptions): ChildProcess {
    return spawn(command, args, options?.cwd ? { cwd: options.cwd } : undefined);
  }
}

// ============================================================================
// Interface
// ============================================================================

export interface GitHubCLIService {
  getStatus(): Promise<GitHubCLIStatus>;
  isAvailable(): Promise<boolean>;
  listRepos(options?: RepoListOptions): Promise<GitHubRepo[]>;
  searchRepos(options: RepoSearchOptions): Promise<GitHubRepo[]>;
  cloneRepo(options: CloneOptions, onProgress?: (progress: CloneProgress) => void): Promise<void>;
  listIssues(options: IssueListOptions): Promise<GitHubIssue[]>;
  viewIssue(options: IssueViewOptions): Promise<GitHubIssueDetail>;
  closeIssue(repo: string, issueNumber: number): Promise<void>;
  commentOnIssue(repo: string, issueNumber: number, body: string): Promise<void>;
  createIssue(options: IssueCreateOptions): Promise<GitHubIssue>;
  listLabels(repo: string): Promise<GitHubLabel[]>;
  listMilestones(repo: string): Promise<GitHubMilestone[]>;
  listCollaborators(repo: string): Promise<GitHubCollaborator[]>;
  createPR(options: PRCreateOptions): Promise<GitHubPullRequest>;
  listPRs(options: PRListOptions): Promise<GitHubPullRequest[]>;
  viewPR(options: PRViewOptions): Promise<GitHubPRDetail>;
  commentOnPR(repo: string, prNumber: number, body: string): Promise<void>;
  markPRReady(repo: string, prNumber: number): Promise<void>;
  mergePR(repo: string, prNumber: number, method?: 'merge' | 'squash' | 'rebase'): Promise<void>;
}

// ============================================================================
// Implementation
// ============================================================================

const REPO_JSON_FIELDS = 'name,nameWithOwner,description,url,isPrivate,primaryLanguage,updatedAt,stargazerCount';
const ISSUE_JSON_FIELDS = 'number,title,body,state,url,author,labels,assignees,milestone,createdAt,updatedAt,comments';
const PR_JSON_FIELDS = 'number,title,body,state,isDraft,url,author,headRefName,baseRefName,labels,reviewDecision,createdAt,updatedAt';

export class DefaultGitHubCLIService implements GitHubCLIService {
  private readonly commandRunner: CommandRunner;

  constructor(commandRunner?: CommandRunner) {
    this.commandRunner = commandRunner || new DefaultCommandRunner();
  }

  async getStatus(): Promise<GitHubCLIStatus> {
    const version = await this.detectVersion();

    if (!version) {
      return {
        installed: false,
        version: null,
        authenticated: false,
        username: null,
        error: null,
      };
    }

    const authResult = await this.detectAuth();

    return {
      installed: true,
      version,
      authenticated: authResult.authenticated,
      username: authResult.username,
      error: authResult.error,
    };
  }

  async isAvailable(): Promise<boolean> {
    const version = await this.detectVersion();
    return version !== null;
  }

  async listRepos(options: RepoListOptions = {}): Promise<GitHubRepo[]> {
    const args = buildRepoListArgs(options);

    try {
      const { stdout } = await this.commandRunner.exec('gh', args);
      return parseRepoListOutput(stdout);
    } catch (err) {
      throw new GitHubCLIError(`Failed to list repos: ${extractErrorMessage(err)}`);
    }
  }

  async searchRepos(options: RepoSearchOptions): Promise<GitHubRepo[]> {
    const args = buildRepoSearchArgs(options);

    try {
      const { stdout } = await this.commandRunner.exec('gh', args);
      return parseRepoSearchOutput(stdout);
    } catch (err) {
      throw new GitHubCLIError(`Failed to search repos: ${extractErrorMessage(err)}`);
    }
  }

  async cloneRepo(
    options: CloneOptions,
    onProgress?: (progress: CloneProgress) => void
  ): Promise<void> {
    const args = buildCloneArgs(options);

    return new Promise<void>((resolve, reject) => {
      onProgress?.({ phase: 'cloning', message: `Cloning ${options.repo}...` });

      const child = this.commandRunner.spawn('gh', args);
      let stderrBuffer = '';

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderrBuffer += text;
        onProgress?.({ phase: 'cloning', message: text.trim() });
      });

      child.on('close', (code) => {
        if (code === 0) {
          onProgress?.({ phase: 'done', message: 'Clone completed' });
          resolve();
        } else {
          const errorMsg = stderrBuffer.trim() || `Clone failed with exit code ${code}`;
          onProgress?.({ phase: 'error', message: errorMsg });
          reject(new GitHubCLIError(`Clone failed: ${errorMsg}`));
        }
      });

      child.on('error', (err) => {
        const msg = err.message;
        onProgress?.({ phase: 'error', message: msg });
        reject(new GitHubCLIError(`Clone failed: ${msg}`));
      });
    });
  }

  async listIssues(options: IssueListOptions): Promise<GitHubIssue[]> {
    const args = buildIssueListArgs(options);

    try {
      const { stdout } = await this.commandRunner.exec('gh', args);
      return parseIssueListOutput(stdout);
    } catch (err) {
      throw new GitHubCLIError(`Failed to list issues: ${extractErrorMessage(err)}`);
    }
  }

  async viewIssue(options: IssueViewOptions): Promise<GitHubIssueDetail> {
    const args = buildIssueViewArgs(options);

    try {
      const { stdout } = await this.commandRunner.exec('gh', args);
      const issue = parseIssueViewOutput(stdout);
      const comments = await this.fetchIssueComments(options);
      return { issue, comments };
    } catch (err) {
      throw new GitHubCLIError(`Failed to view issue: ${extractErrorMessage(err)}`);
    }
  }

  async closeIssue(repo: string, issueNumber: number): Promise<void> {
    try {
      await this.commandRunner.exec('gh', [
        'issue', 'close', String(issueNumber), '--repo', repo,
      ]);
    } catch (err) {
      throw new GitHubCLIError(`Failed to close issue: ${extractErrorMessage(err)}`);
    }
  }

  async commentOnIssue(repo: string, issueNumber: number, body: string): Promise<void> {
    try {
      await this.commandRunner.exec('gh', [
        'issue', 'comment', String(issueNumber), '--repo', repo, '--body', body,
      ]);
    } catch (err) {
      throw new GitHubCLIError(`Failed to comment on issue: ${extractErrorMessage(err)}`);
    }
  }

  async createIssue(options: IssueCreateOptions): Promise<GitHubIssue> {
    const args = buildIssueCreateArgs(options);

    try {
      const { stdout } = await this.commandRunner.exec('gh', args);
      const issueNumber = extractIssueNumberFromUrl(stdout.trim());
      const viewArgs = buildIssueViewArgs({ repo: options.repo, issueNumber });
      const viewResult = await this.commandRunner.exec('gh', viewArgs);
      return parseIssueViewOutput(viewResult.stdout);
    } catch (err) {
      throw new GitHubCLIError(`Failed to create issue: ${extractErrorMessage(err)}`);
    }
  }

  async listLabels(repo: string): Promise<GitHubLabel[]> {
    try {
      const { stdout } = await this.commandRunner.exec('gh', [
        'label', 'list', '--repo', repo, '--json', 'name,color,description',
      ]);
      return JSON.parse(stdout || '[]') as GitHubLabel[];
    } catch (err) {
      throw new GitHubCLIError(`Failed to list labels: ${extractErrorMessage(err)}`);
    }
  }

  async listMilestones(repo: string): Promise<GitHubMilestone[]> {
    try {
      const { stdout } = await this.commandRunner.exec('gh', [
        'api', `repos/${repo}/milestones`,
        '--jq', '[.[] | {title: .title, number: .number, state: .state}]',
      ]);
      return JSON.parse(stdout || '[]') as GitHubMilestone[];
    } catch (err) {
      throw new GitHubCLIError(`Failed to list milestones: ${extractErrorMessage(err)}`);
    }
  }

  async listCollaborators(repo: string): Promise<GitHubCollaborator[]> {
    try {
      const { stdout } = await this.commandRunner.exec('gh', [
        'api', `repos/${repo}/collaborators`,
        '--jq', '[.[] | {login: .login}]',
      ]);
      return JSON.parse(stdout || '[]') as GitHubCollaborator[];
    } catch (err) {
      throw new GitHubCLIError(`Failed to list collaborators: ${extractErrorMessage(err)}`);
    }
  }

  async commentOnPR(repo: string, prNumber: number, body: string): Promise<void> {
    try {
      await this.commandRunner.exec('gh', [
        'pr', 'comment', String(prNumber), '--repo', repo, '--body', body,
      ]);
    } catch (err) {
      throw new GitHubCLIError(`Failed to comment on PR: ${extractErrorMessage(err)}`);
    }
  }

  async markPRReady(repo: string, prNumber: number): Promise<void> {
    try {
      await this.commandRunner.exec('gh', [
        'pr', 'ready', String(prNumber), '--repo', repo,
      ]);
    } catch (err) {
      throw new GitHubCLIError(`Failed to mark PR as ready: ${extractErrorMessage(err)}`);
    }
  }

  async mergePR(repo: string, prNumber: number, method: 'merge' | 'squash' | 'rebase' = 'merge'): Promise<void> {
    try {
      await this.commandRunner.exec('gh', [
        'pr', 'merge', String(prNumber), '--repo', repo,
        `--${method}`, '--delete-branch',
      ]);
    } catch (err) {
      throw new GitHubCLIError(`Failed to merge PR: ${extractErrorMessage(err)}`);
    }
  }

  async createPR(options: PRCreateOptions): Promise<GitHubPullRequest> {
    const args = buildPRCreateArgs(options);
    const execOpts = options.cwd ? { cwd: options.cwd } : undefined;

    try {
      const { stdout } = await this.commandRunner.exec('gh', args, execOpts);
      const prNumber = extractPRNumberFromUrl(stdout.trim());
      const viewArgs = buildPRViewArgs({ repo: options.repo, prNumber });
      const viewResult = await this.commandRunner.exec('gh', viewArgs);
      return parsePRViewOutput(viewResult.stdout);
    } catch (err) {
      throw new GitHubCLIError(`Failed to create PR: ${extractErrorMessage(err)}`);
    }
  }

  async listPRs(options: PRListOptions): Promise<GitHubPullRequest[]> {
    const args = buildPRListArgs(options);

    try {
      const { stdout } = await this.commandRunner.exec('gh', args);
      return parsePRListOutput(stdout);
    } catch (err) {
      throw new GitHubCLIError(`Failed to list PRs: ${extractErrorMessage(err)}`);
    }
  }

  async viewPR(options: PRViewOptions): Promise<GitHubPRDetail> {
    const args = buildPRViewArgs(options);

    try {
      const { stdout } = await this.commandRunner.exec('gh', args);
      const pr = parsePRViewOutput(stdout);
      const reviews = await this.fetchPRReviews(options);
      const comments = await this.fetchPRComments(options);
      return { pr, reviews, comments };
    } catch (err) {
      throw new GitHubCLIError(`Failed to view PR: ${extractErrorMessage(err)}`);
    }
  }

  private async fetchPRReviews(options: PRViewOptions): Promise<GitHubPRReview[]> {
    try {
      const { stdout } = await this.commandRunner.exec('gh', [
        'api', `repos/${options.repo}/pulls/${options.prNumber}/reviews`,
        '--jq', '[.[] | {author: .user.login, state: .state, body: .body, submittedAt: .submitted_at}]',
      ]);
      return JSON.parse(stdout || '[]') as GitHubPRReview[];
    } catch {
      return [];
    }
  }

  private async fetchPRComments(options: PRViewOptions): Promise<GitHubPRComment[]> {
    try {
      const { stdout } = await this.commandRunner.exec('gh', [
        'api', `repos/${options.repo}/pulls/${options.prNumber}/comments`,
        '--jq', '[.[] | {author: .user.login, body: .body, path: .path, line: .line, createdAt: .created_at}]',
      ]);
      return JSON.parse(stdout || '[]') as GitHubPRComment[];
    } catch {
      return [];
    }
  }

  private async fetchIssueComments(options: IssueViewOptions): Promise<GitHubIssueComment[]> {
    try {
      const { stdout } = await this.commandRunner.exec('gh', [
        'api', `repos/${options.repo}/issues/${options.issueNumber}/comments`,
        '--jq', `[.[] | {author: .user.login, body: .body, createdAt: .created_at}]`,
      ]);
      return JSON.parse(stdout || '[]') as GitHubIssueComment[];
    } catch {
      return [];
    }
  }

  private async detectVersion(): Promise<string | null> {
    try {
      const { stdout } = await this.commandRunner.exec('gh', ['--version']);
      return parseVersion(stdout);
    } catch {
      return null;
    }
  }

  private async detectAuth(): Promise<{ authenticated: boolean; username: string | null; error: string | null }> {
    try {
      const { stdout } = await this.commandRunner.exec('gh', ['auth', 'status']);
      return {
        authenticated: true,
        username: parseUsername(stdout),
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error
        ? (err as NodeJS.ErrnoException & { stderr?: string }).stderr || err.message
        : String(err);

      if (message.includes('not logged')) {
        return { authenticated: false, username: null, error: null };
      }

      return {
        authenticated: false,
        username: null,
        error: new GitHubCLIError(`Auth check failed: ${message}`).message,
      };
    }
  }
}

// ============================================================================
// Arg Builders
// ============================================================================

function buildRepoListArgs(options: RepoListOptions): string[] {
  const args = ['repo', 'list'];

  if (options.owner) {
    args.push(options.owner);
  }

  args.push('--json', REPO_JSON_FIELDS);
  args.push('--limit', String(options.limit || 30));

  if (options.language) {
    args.push('--language', options.language);
  }

  return args;
}

function buildRepoSearchArgs(options: RepoSearchOptions): string[] {
  const args = ['search', 'repos', options.query];
  args.push('--json', REPO_JSON_FIELDS);
  args.push('--limit', String(options.limit || 30));

  if (options.language) {
    args.push('--language', options.language);
  }

  if (options.sort) {
    args.push('--sort', options.sort);
  }

  return args;
}

function buildCloneArgs(options: CloneOptions): string[] {
  const args = ['repo', 'clone', options.repo, options.targetDir];

  if (options.branch) {
    args.push('--', '--branch', options.branch);
  }

  return args;
}

function buildIssueListArgs(options: IssueListOptions): string[] {
  const args = ['issue', 'list', '--repo', options.repo];
  args.push('--json', ISSUE_JSON_FIELDS);
  args.push('--limit', String(options.limit || 30));
  args.push('--state', options.state || 'open');

  if (options.label) {
    args.push('--label', options.label);
  }

  if (options.assignee) {
    args.push('--assignee', options.assignee);
  }

  if (options.milestone) {
    args.push('--milestone', options.milestone);
  }

  return args;
}

function buildIssueViewArgs(options: IssueViewOptions): string[] {
  return [
    'issue', 'view', String(options.issueNumber),
    '--repo', options.repo,
    '--json', ISSUE_JSON_FIELDS,
  ];
}

function buildIssueCreateArgs(options: IssueCreateOptions): string[] {
  const args = [
    'issue', 'create',
    '--repo', options.repo,
    '--title', options.title,
  ];

  if (options.body) {
    args.push('--body', options.body);
  }

  for (const label of options.labels || []) {
    args.push('--label', label);
  }

  for (const assignee of options.assignees || []) {
    args.push('--assignee', assignee);
  }

  if (options.milestone) {
    args.push('--milestone', options.milestone);
  }

  return args;
}

function buildPRCreateArgs(options: PRCreateOptions): string[] {
  const args = [
    'pr', 'create',
    '--repo', options.repo,
    '--title', options.title,
    '--body', options.body,
  ];

  if (options.base) {
    args.push('--base', options.base);
  }

  if (options.head) {
    args.push('--head', options.head);
  }

  if (options.draft) {
    args.push('--draft');
  }

  return args;
}

function buildPRListArgs(options: PRListOptions): string[] {
  const args = ['pr', 'list', '--repo', options.repo];
  args.push('--json', PR_JSON_FIELDS);
  args.push('--limit', String(options.limit || 30));
  args.push('--state', options.state || 'open');

  return args;
}

function buildPRViewArgs(options: PRViewOptions): string[] {
  return [
    'pr', 'view', String(options.prNumber),
    '--repo', options.repo,
    '--json', PR_JSON_FIELDS,
  ];
}

// ============================================================================
// Parsers
// ============================================================================

function extractPRNumberFromUrl(url: string): number {
  const match = url.match(/\/pull\/(\d+)/);

  if (!match) {
    throw new GitHubCLIError(`Could not extract PR number from: ${url}`);
  }

  return parseInt(match[1]!, 10);
}

function extractIssueNumberFromUrl(url: string): number {
  const match = url.match(/\/issues\/(\d+)/);

  if (!match) {
    throw new GitHubCLIError(`Could not extract issue number from: ${url}`);
  }

  return parseInt(match[1]!, 10);
}

function parseVersion(output: string): string | null {
  const match = output.match(/gh version (\S+)/);
  return match ? match[1]! : null;
}

function parseUsername(output: string): string | null {
  const match = output.match(/account\s+(\S+)/);
  return match ? match[1]! : null;
}

interface GhRepoListItem {
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  isPrivate: boolean;
  primaryLanguage: { name: string } | null;
  updatedAt: string;
  stargazerCount: number;
}

function mapRepoItem(item: GhRepoListItem): GitHubRepo {
  return {
    name: item.name,
    fullName: item.nameWithOwner,
    description: item.description,
    url: item.url,
    isPrivate: item.isPrivate,
    language: item.primaryLanguage?.name || null,
    updatedAt: item.updatedAt,
    stargazerCount: item.stargazerCount,
  };
}

function parseRepoListOutput(stdout: string): GitHubRepo[] {
  const items = JSON.parse(stdout || '[]') as GhRepoListItem[];
  return items.map(mapRepoItem);
}

interface GhSearchRepoItem {
  name: string;
  nameWithOwner?: string;
  fullName?: string;
  description: string | null;
  url?: string;
  htmlUrl?: string;
  isPrivate?: boolean;
  visibility?: string;
  primaryLanguage: { name: string } | null;
  updatedAt: string;
  stargazerCount: number;
}

function parseRepoSearchOutput(stdout: string): GitHubRepo[] {
  const items = JSON.parse(stdout || '[]') as GhSearchRepoItem[];

  return items.map((item) => ({
    name: item.name,
    fullName: item.nameWithOwner || item.fullName || item.name,
    description: item.description,
    url: item.url || item.htmlUrl || '',
    isPrivate: item.isPrivate ?? item.visibility === 'private',
    language: item.primaryLanguage?.name || null,
    updatedAt: item.updatedAt,
    stargazerCount: item.stargazerCount,
  }));
}

interface GhIssueItem {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  author: { login: string };
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  milestone: { title: string } | null;
  createdAt: string;
  updatedAt: string;
  comments: Array<{ author: { login: string }; body: string; createdAt: string }>;
}

function mapIssueItem(item: GhIssueItem): GitHubIssue {
  return {
    number: item.number,
    title: item.title,
    body: item.body || '',
    state: item.state,
    url: item.url,
    author: item.author?.login || 'unknown',
    labels: (item.labels || []).map(l => l.name),
    assignees: (item.assignees || []).map(a => a.login),
    milestone: item.milestone?.title || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    commentsCount: (item.comments || []).length,
  };
}

function parseIssueListOutput(stdout: string): GitHubIssue[] {
  const items = JSON.parse(stdout || '[]') as GhIssueItem[];
  return items.map(mapIssueItem);
}

function parseIssueViewOutput(stdout: string): GitHubIssue {
  const item = JSON.parse(stdout) as GhIssueItem;
  return mapIssueItem(item);
}

interface GhPRItem {
  number: number;
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  url: string;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  labels: Array<{ name: string }>;
  reviewDecision: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapPRItem(item: GhPRItem): GitHubPullRequest {
  return {
    number: item.number,
    title: item.title,
    body: item.body || '',
    state: item.state,
    isDraft: item.isDraft ?? false,
    url: item.url,
    author: item.author?.login || 'unknown',
    headBranch: item.headRefName,
    baseBranch: item.baseRefName,
    labels: (item.labels || []).map(l => l.name),
    reviewDecision: item.reviewDecision,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function parsePRListOutput(stdout: string): GitHubPullRequest[] {
  const items = JSON.parse(stdout || '[]') as GhPRItem[];
  return items.map(mapPRItem);
}

function parsePRViewOutput(stdout: string): GitHubPullRequest {
  const item = JSON.parse(stdout) as GhPRItem;
  return mapPRItem(item);
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return (err as NodeJS.ErrnoException & { stderr?: string }).stderr || err.message;
  }

  return String(err);
}

// ============================================================================
// Factory
// ============================================================================

export function createGitHubCLIService(commandRunner?: CommandRunner): GitHubCLIService {
  return new DefaultGitHubCLIService(commandRunner);
}
