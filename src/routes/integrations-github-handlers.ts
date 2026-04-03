import path from 'path';
import { Request, Response } from 'express';
import {
  GitHubCLIService,
  RepoListOptions,
  RepoSearchOptions,
  IssueListOptions,
  IssueCreateOptions,
  PRListOptions,
} from '../services/github-cli-service';
import { ProjectService } from '../services/project';
import { ProjectRepository } from '../repositories';
import { ValidationError } from '../utils/errors';
import { WebSocketMessage } from '../websocket/websocket-server';

export interface GitHubHandlerDeps {
  githubCLIService: GitHubCLIService;
  projectService: ProjectService;
  projectRepository: ProjectRepository;
  broadcast?: (message: WebSocketMessage) => void;
}

export function handleGetStatus(deps: GitHubHandlerDeps) {
  return async (_req: Request, res: Response): Promise<void> => {
    const status = await deps.githubCLIService.getStatus();
    res.json(status);
  };
}

export function handleListRepos(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const options: RepoListOptions = {
      owner: req.query['owner'] as string | undefined,
      language: req.query['language'] as string | undefined,
      limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
    };

    const repos = await deps.githubCLIService.listRepos(options);
    res.json(repos);
  };
}

export function handleSearchRepos(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const query = req.query['query'] as string | undefined;

    if (!query) {
      throw new ValidationError('query parameter is required');
    }

    const options: RepoSearchOptions = {
      query,
      language: req.query['language'] as string | undefined,
      sort: req.query['sort'] as 'stars' | 'forks' | 'updated' | undefined,
      limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
    };

    const repos = await deps.githubCLIService.searchRepos(options);
    res.json(repos);
  };
}

export function handleCloneRepo(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { repo, targetDir, branch, projectName } = req.body as {
      repo?: string;
      targetDir?: string;
      branch?: string;
      projectName?: string;
    };

    validateCloneInput(repo, targetDir);

    const repoName = projectName || extractRepoName(repo!);
    const clonePath = path.join(targetDir!, repoName);

    await deps.githubCLIService.cloneRepo(
      { repo: repo!, targetDir: clonePath, branch },
      (progress) => {
        deps.broadcast?.({
          type: 'github_clone_progress',
          data: { repo: repo!, ...progress },
        });
      }
    );

    const result = await deps.projectService.createProject({
      name: projectName || repoName,
      path: clonePath,
      createNew: false,
    });

    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, project: result.project });
  };
}

function requireRepo(req: Request): string {
  const repo = req.query['repo'] as string | undefined;

  if (!repo) {
    throw new ValidationError('repo parameter is required');
  }

  return repo;
}

function requireIssueNumber(req: Request): number {
  const issueNumber = parseInt(req.params['issueNumber'] as string, 10);

  if (isNaN(issueNumber)) {
    throw new ValidationError('issueNumber must be a number');
  }

  return issueNumber;
}

function requirePRNumber(req: Request): number {
  const prNumber = parseInt(req.params['prNumber'] as string, 10);

  if (isNaN(prNumber)) {
    throw new ValidationError('prNumber must be a number');
  }

  return prNumber;
}

export function handleListIssues(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const repo = requireRepo(req);

    const options: IssueListOptions = {
      repo,
      state: (req.query['state'] as 'open' | 'closed' | 'all') || undefined,
      label: req.query['label'] as string | undefined,
      assignee: req.query['assignee'] as string | undefined,
      milestone: req.query['milestone'] as string | undefined,
      limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
    };

    const issues = await deps.githubCLIService.listIssues(options);
    res.json(issues);
  };
}

export function handleViewIssue(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const repo = requireRepo(req);
    const issueNumber = requireIssueNumber(req);

    const detail = await deps.githubCLIService.viewIssue({ repo, issueNumber });
    res.json(detail);
  };
}

export function handleCloseIssue(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const repo = requireRepo(req);
    const issueNumber = requireIssueNumber(req);

    await deps.githubCLIService.closeIssue(repo, issueNumber);
    res.json({ success: true });
  };
}

export function handleCommentOnIssue(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const repo = requireRepo(req);
    const issueNumber = requireIssueNumber(req);
    const { body } = req.body as { body?: string };

    if (!body) {
      throw new ValidationError('body is required');
    }

    await deps.githubCLIService.commentOnIssue(repo, issueNumber, body);
    res.json({ success: true });
  };
}

export function handleCreateIssue(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { repo, title, body, labels, assignees, milestone } = req.body as {
      repo?: string;
      title?: string;
      body?: string;
      labels?: string[];
      assignees?: string[];
      milestone?: string;
    };

    if (!repo) {
      throw new ValidationError('repo is required');
    }

    if (!title) {
      throw new ValidationError('title is required');
    }

    const options: IssueCreateOptions = {
      repo,
      title,
      body: body || '',
      labels: labels || [],
      assignees: assignees || [],
      milestone: milestone || undefined,
    };

    const issue = await deps.githubCLIService.createIssue(options);
    res.json(issue);
  };
}

export function handleListLabels(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const repo = requireRepo(req);
    const labels = await deps.githubCLIService.listLabels(repo);
    res.json(labels);
  };
}

export function handleListMilestones(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const repo = requireRepo(req);
    const milestones = await deps.githubCLIService.listMilestones(repo);
    res.json(milestones);
  };
}

export function handleListCollaborators(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const repo = requireRepo(req);
    const collaborators = await deps.githubCLIService.listCollaborators(repo);
    res.json(collaborators);
  };
}

export function handleCreatePR(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { repo, title, body, base, head, draft, projectId } = req.body as {
      repo?: string;
      title?: string;
      body?: string;
      base?: string;
      head?: string;
      draft?: boolean;
      projectId?: string;
    };

    if (!repo) {
      throw new ValidationError('repo is required');
    }

    if (!title) {
      throw new ValidationError('title is required');
    }

    let cwd: string | undefined;

    if (projectId) {
      const project = await deps.projectRepository.findById(projectId);

      if (project) {
        cwd = project.path;
      }
    }

    const pr = await deps.githubCLIService.createPR({
      repo,
      title,
      body: body || '',
      base,
      head,
      draft,
      cwd,
    });

    res.json(pr);
  };
}

export function handleListPRs(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const repo = requireRepo(req);

    const options: PRListOptions = {
      repo,
      state: (req.query['state'] as PRListOptions['state']) || undefined,
      limit: req.query['limit']
        ? parseInt(req.query['limit'] as string, 10)
        : undefined,
    };

    const pulls = await deps.githubCLIService.listPRs(options);
    res.json(pulls);
  };
}

export function handleViewPR(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const repo = requireRepo(req);
    const prNumber = requirePRNumber(req);

    const detail = await deps.githubCLIService.viewPR({ repo, prNumber });
    res.json(detail);
  };
}

export function handleCommentOnPR(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const repo = requireRepo(req);
    const prNumber = requirePRNumber(req);
    const { body } = req.body as { body?: string };

    if (!body) {
      throw new ValidationError('body is required');
    }

    await deps.githubCLIService.commentOnPR(repo, prNumber, body);
    res.json({ success: true });
  };
}

export function handleMergePR(deps: GitHubHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const repo = requireRepo(req);
    const prNumber = requirePRNumber(req);
    const { method, isDraft } = req.body as {
      method?: 'merge' | 'squash' | 'rebase';
      isDraft?: boolean;
    };

    if (isDraft) {
      await deps.githubCLIService.markPRReady(repo, prNumber);
    }

    await deps.githubCLIService.mergePR(repo, prNumber, method);
    res.json({ success: true });
  };
}

function validateCloneInput(repo?: string, targetDir?: string): void {
  if (!repo) {
    throw new ValidationError('repo is required');
  }

  if (!targetDir) {
    throw new ValidationError('targetDir is required');
  }

  if (!path.isAbsolute(targetDir)) {
    throw new ValidationError('targetDir must be an absolute path');
  }
}

function extractRepoName(repo: string): string {
  const parts = repo.replace(/\.git$/, '').split('/');
  return parts[parts.length - 1] || repo;
}
