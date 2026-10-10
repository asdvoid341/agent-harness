/**
 * Site configuration.
 *  - repoUrl: your GitHub repository, so the guide's "where in the code" links work.
 *  - author / authorUrl: shown as the byline in the header ("by …"). Leave
 *    author empty to hide the byline.
 *  - writeupUrl: optional link to a blog post or write-up about the project.
 */
export const APP_CONFIG = {
  repoUrl: 'https://github.com/YOUR-GITHUB-USERNAME/agent-harness',
  branch: 'main',
  author: '',
  authorUrl: '',
  writeupUrl: '',
};

export const sourceUrl = (path) => `${APP_CONFIG.repoUrl}/${path.endsWith('/') ? 'tree' : 'blob'}/${APP_CONFIG.branch}/${path}`;
