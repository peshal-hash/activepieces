import { t } from 'i18next';
import { Folder } from 'lucide-react';
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { projectCollectionUtils } from '@/hooks/project-collection';
import { determineDefaultRoute } from '@/lib/utils';

export const ProjectSwitcher = React.memo(() => {
  const { data: projects } = projectCollectionUtils.useAll();
  const { project: currentProject } = projectCollectionUtils.useCurrentProject();
  const { checkAccess } = useAuthorization();
  const location = useLocation();
  const navigate = useNavigate();

  const handleProjectChange = (projectId: string) => {
    if (projectId === currentProject.id) {
      return;
    }

    projectCollectionUtils.setCurrentProject(projectId);

    const nextPath = location.pathname.includes('/projects/')
      ? location.pathname.replace(/\/projects\/[^/]+/, `/projects/${projectId}`)
      : determineDefaultRoute(checkAccess);

    navigate(`${nextPath}${location.search}`);
  };

  if (projects.length === 0) {
    return null;
  }

  return (
    <Select value={currentProject.id} onValueChange={handleProjectChange}>
      <SelectTrigger className="w-full">
        <Folder className="w-4 h-4 mr-2 text-muted-foreground" />
        <SelectValue placeholder={t('Select project')} />
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});

ProjectSwitcher.displayName = 'ProjectSwitcher';
