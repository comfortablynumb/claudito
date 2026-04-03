import { Request, Response } from 'express';
import { ValidationError } from '../../utils';
import { SUPPORTED_MODELS, isValidModel, getModelDisplayName, DEFAULT_MODEL } from '../../config/models';
import { AgentProfile, DEFAULT_AGENT_PROFILE } from '../../repositories';
import {
  PermissionOverridesBody,
  ModelOverrideBody,
  McpOverridesBody
} from './types';
import { ProjectRouterDependencies } from './types';

function resolveEffectiveProfile(profiles: AgentProfile[], profileId?: string | null): AgentProfile {
  if (profileId) {
    const found = profiles.find(p => p.id === profileId);

    if (found) return found;
  }

  const defaultProfile = profiles.find(p => p.isDefault);
  return defaultProfile || profiles[0] || DEFAULT_AGENT_PROFILE;
}

export function handleGetPermissions() {
  return (req: Request, res: Response): void => {
    const project = req.project!;

    res.json((project).permissionOverrides || {
      enabled: false,
      allowRules: [],
      denyRules: [],
      defaultMode: null
    });
  };
}

export function handleUpdatePermissions(deps: ProjectRouterDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const body = req.body as PermissionOverridesBody;

    if (body.enabled === false) {
      const overrides = await deps.projectRepository.updatePermissionOverrides(id, null);
      res.json(overrides);
      return;
    }

    const overrides = await deps.projectRepository.updatePermissionOverrides(id, {
      enabled: body.enabled ?? false,
      allowRules: body.allowRules ?? [],
      denyRules: body.denyRules ?? [],
      defaultMode: body.defaultMode || undefined
    });

    res.json(overrides);
  };
}

export function handleGetModel() {
  return (req: Request, res: Response): void => {
    const project = req.project!;
    const effectiveModel = (project).modelOverride || DEFAULT_MODEL;

    res.json({
      projectModel: (project).modelOverride,
      defaultModel: DEFAULT_MODEL,
      effectiveModel,
      availableModels: SUPPORTED_MODELS.map(m => ({
        id: m,
        name: getModelDisplayName(m),
        isDefault: m === DEFAULT_MODEL,
        isCurrent: m === effectiveModel
      }))
    });
  };
}

export function handleUpdateModel(deps: ProjectRouterDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const body = req.body as ModelOverrideBody;
    const { model } = body;

    if (model !== null && model !== undefined) {
      if (!isValidModel(model)) {
        throw new ValidationError(`Invalid model: ${model}. Supported models: ${SUPPORTED_MODELS.join(', ')}`);
      }
    }

    await deps.projectRepository.updateModelOverride(id, model ?? null);
    const effectiveModel = model || DEFAULT_MODEL;

    res.json({
      projectModel: model,
      defaultModel: DEFAULT_MODEL,
      effectiveModel,
      updated: true
    });
  };
}

export function handleGetMcpOverrides() {
  return (req: Request, res: Response): void => {
    const project = req.project!;

    res.json((project).mcpOverrides || {
      enabled: false,
      serverOverrides: {}
    });
  };
}

export function handleUpdateMcpOverrides(deps: ProjectRouterDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const body = req.body as McpOverridesBody;
    const { agentManager, projectRepository } = deps;

    const shouldClear = body.enabled === false &&
      (!body.serverOverrides || Object.keys(body.serverOverrides).length === 0);

    const overrides = shouldClear
      ? await projectRepository.updateMcpOverrides(id, null)
      : await projectRepository.updateMcpOverrides(id, {
          enabled: body.enabled ?? true,
          serverOverrides: body.serverOverrides || {}
        });

    const agentStatus = agentManager.getAgentStatus(id);

    if (agentStatus === 'running') {
      await agentManager.restartProjectAgent(id);
    }

    res.json({
      overrides,
      agentRestarted: agentStatus === 'running'
    });
  };
}

export function handleGetDocker(deps: ProjectRouterDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const project = req.project!;
    const settings = await deps.settingsRepository.get();
    const globalEnabled = settings.docker?.enabled ?? false;

    let effectiveDocker = false;

    if (globalEnabled) {
      if (project.dockerOverride === false) {
        effectiveDocker = false;
      } else {
        effectiveDocker = true;
      }
    }

    const effectiveImage = effectiveDocker
      ? (project.dockerImage || settings.docker?.baseImage || null)
      : null;

    res.json({
      dockerOverride: project.dockerOverride,
      dockerImage: project.dockerImage ?? null,
      effectiveDocker,
      imageName: effectiveImage,
    });
  };
}

export function handleUpdateDocker(deps: ProjectRouterDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const body = req.body as { dockerOverride?: boolean; dockerImage?: string | null };
    const { dockerOverride, dockerImage } = body;

    if (dockerOverride !== undefined && typeof dockerOverride !== 'boolean') {
      throw new ValidationError('dockerOverride must be a boolean');
    }

    if (dockerImage !== undefined && dockerImage !== null && typeof dockerImage !== 'string') {
      throw new ValidationError('dockerImage must be a string or null');
    }

    if (dockerOverride !== undefined) {
      await deps.projectRepository.updateDockerOverride(id, dockerOverride);
    }

    if (dockerImage !== undefined) {
      await deps.projectRepository.updateDockerImage(id, dockerImage);
    }

    res.json({
      dockerOverride,
      dockerImage,
      updated: true,
    });
  };
}

export function handleGetAgentProfile(deps: ProjectRouterDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const project = (await deps.projectRepository.findById(id))!;
    const settings = await deps.settingsRepository.get();
    const profiles = settings.agentProfiles || [];

    const effectiveProfile = resolveEffectiveProfile(profiles, project.agentProfileId);

    res.json({
      agentProfileId: project.agentProfileId ?? null,
      effectiveProfile,
    });
  };
}

export function handleUpdateAgentProfile(deps: ProjectRouterDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const body = req.body as { profileId: string | null };
    const { profileId } = body;

    if (profileId !== null) {
      if (typeof profileId !== 'string' || profileId.trim().length === 0) {
        throw new ValidationError('profileId must be a non-empty string or null');
      }

      const settings = await deps.settingsRepository.get();
      const profiles = settings.agentProfiles || [];
      const exists = profiles.some(p => p.id === profileId);

      if (!exists) {
        throw new ValidationError(`Profile not found: ${profileId}`);
      }
    }

    await deps.projectRepository.updateAgentProfileId(id, profileId);
    const settings = await deps.settingsRepository.get();
    const effectiveProfile = resolveEffectiveProfile(settings.agentProfiles || [], profileId);

    res.json({
      agentProfileId: profileId,
      effectiveProfile,
      updated: true,
    });
  };
}
