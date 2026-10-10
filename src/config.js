/**
 * Site configuration. Set `repoUrl` to your GitHub repository so the guide's
 * "where in the code" links point at the real source files.
 */
export const APP_CONFIG = {
  repoUrl: 'https://github.com/YOUR-GITHUB-USERNAME/agent-harness',
  branch: 'main',
};

export const sourceUrl = (path) => `${APP_CONFIG.repoUrl}/${path.endsWith('/') ? 'tree' : 'blob'}/${APP_CONFIG.branch}/${path}`;
