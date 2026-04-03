import { Request, Response } from 'express';
import { ProjectRouterDependencies } from './types';
import {
  inventifyStartSchema,
  inventifySelectSchema,
  inventifySuggestNamesSchema,
  inventifyCompleteBuildSchema,
} from './schemas';

function requireService(deps: ProjectRouterDependencies, res: Response): boolean {
  if (!deps.inventifyService) {
    res.status(503).json({ error: 'Inventify service not available' });
    return false;
  }

  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function handleStart(deps: ProjectRouterDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireService(deps, res)) return;

    const parseResult = inventifyStartSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
      return;
    }

    try {
      const settings = await deps.settingsRepository.get();

      if (!settings.inventifyFolder) {
        res.status(400).json({ error: 'Inventify folder not configured. Set it in Settings.' });
        return;
      }

      const { projectTypes, themes, languages, technologies, customPrompt } = parseResult.data;

      const result = await deps.inventifyService!.start({
        projectTypes,
        themes,
        languages,
        technologies,
        customPrompt,
        inventifyFolder: settings.inventifyFolder,
      });

      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };
}

export function handleGetIdeas(deps: ProjectRouterDependencies) {
  return (_req: Request, res: Response): void => {
    if (!requireService(deps, res)) return;

    const ideas = deps.inventifyService!.getIdeas();

    if (!ideas) {
      res.status(404).json({ error: 'No ideas available' });
      return;
    }

    res.json({ ideas });
  };
}

export function handleCancel(deps: ProjectRouterDependencies) {
  return async (_req: Request, res: Response): Promise<void> => {
    if (!requireService(deps, res)) return;

    try {
      await deps.inventifyService!.cancel();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };
}

export function handleSuggestNames(deps: ProjectRouterDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireService(deps, res)) return;

    const parseResult = inventifySuggestNamesSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
      return;
    }

    try {
      const { selectedIndex } = parseResult.data;
      const result = await deps.inventifyService!.suggestNames(selectedIndex);
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };
}

export function handleGetNameSuggestions(deps: ProjectRouterDependencies) {
  return (_req: Request, res: Response): void => {
    if (!requireService(deps, res)) return;

    const suggestions = deps.inventifyService!.getNameSuggestions();

    if (!suggestions) {
      res.status(404).json({ error: 'No name suggestions available' });
      return;
    }

    res.json(suggestions);
  };
}

export function handleGetBuildResult(deps: ProjectRouterDependencies) {
  return (_req: Request, res: Response): void => {
    if (!requireService(deps, res)) return;

    const result = deps.inventifyService!.getBuildResult();

    if (!result) {
      res.status(404).json({ error: 'No build result available' });
      return;
    }

    res.json(result);
  };
}

export function handleCompleteBuild(deps: ProjectRouterDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireService(deps, res)) return;

    const parseResult = inventifyCompleteBuildSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
      return;
    }

    try {
      const { projectId } = parseResult.data;
      const project = await deps.projectRepository.findById(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      await deps.inventifyService!.completeBuild(projectId, project.path);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };
}

export function handleSelect(deps: ProjectRouterDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireService(deps, res)) return;

    const parseResult = inventifySelectSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
      return;
    }

    try {
      const { selectedIndex, projectName } = parseResult.data;
      const result = await deps.inventifyService!.selectIdea(selectedIndex, projectName);
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  };
}
