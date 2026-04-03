import { Router } from 'express';
import { ProjectRouterDependencies } from './types';
import {
  handleStart,
  handleGetIdeas,
  handleCancel,
  handleSuggestNames,
  handleGetNameSuggestions,
  handleGetBuildResult,
  handleCompleteBuild,
  handleSelect,
} from './inventify-handlers';

export function createInventifyRouter(
  deps: ProjectRouterDependencies,
): Router {
  const router = Router();

  router.post('/start', handleStart(deps));
  router.get('/ideas', handleGetIdeas(deps));
  router.post('/cancel', handleCancel(deps));
  router.post('/suggest-names', handleSuggestNames(deps));
  router.get('/name-suggestions', handleGetNameSuggestions(deps));
  router.get('/build-result', handleGetBuildResult(deps));
  router.post('/complete-build', handleCompleteBuild(deps));
  router.post('/select', handleSelect(deps));

  return router;
}
