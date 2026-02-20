import { roleModuleAccess, moduleMetadata } from '../config/roleModuleConfig';

interface UserProfile {
  role: string;
  permissions: string[];
}

export const useAccessControl = (userProfile: UserProfile | null) => {
  const getAccessibleModules = (): string[] => {
    if (!userProfile) return [];
    return roleModuleAccess[userProfile.role] || [];
  };

  const hasAccessToModule = (moduleId: string): boolean => {
    if (!userProfile) return false;
    const accessibleModules = roleModuleAccess[userProfile.role] || [];
    return accessibleModules.includes(moduleId);
  };

  const hasPermission = (permission: string): boolean => {
    if (!userProfile) return false;
    return userProfile.permissions.includes(permission) || userProfile.role === 'admin';
  };

  const getVisibleModuleButtons = (): Array<{
    id: string;
    label: string;
    description: string;
  }> => {
    const accessibleModules = getAccessibleModules();
    return accessibleModules.map((moduleId) => ({
      id: moduleId,
      label: moduleMetadata[moduleId]?.label || moduleId,
      description: moduleMetadata[moduleId]?.description || '',
    }));
  };

  return {
    getAccessibleModules,
    hasAccessToModule,
    hasPermission,
    getVisibleModuleButtons,
  };
};
