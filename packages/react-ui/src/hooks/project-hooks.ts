import { projectCollectionUtils, projectHooks as collectionHooks } from './project-collection';

export const projectHooks = {
  ...collectionHooks,
  useCurrentProject: () => {
    const { project } = projectCollectionUtils.useCurrentProject();
    return { project, isPending: false };
  },
};
