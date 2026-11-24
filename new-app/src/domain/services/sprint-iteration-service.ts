/**
 * Dynamic Sprint Iteration Resolution Service
 * Resolves active iteration paths, sprint numbers, and date windows dynamically
 * instead of copying stale historical iterations from source tasks.
 */

export interface SprintIteration {
  id?: string;
  name: string;
  path: string;
  startDate?: string;
  endDate?: string;
  timeframe?: 'past' | 'current' | 'future';
}

/**
 * Resolves an iteration path from sprint input and default project.
 * Handles numbers, strings, and prefixing.
 */
export function resolveSprintIteration(
  sprintInput: string | number | undefined | null,
  defaultProject = '3in1_Agile_Projects'
): string {
  if (sprintInput === undefined || sprintInput === null) return defaultProject;
  const str = String(sprintInput).trim();
  if (!str) return defaultProject;
  if (str.startsWith(defaultProject)) return str;
  if (/^\d+$/.test(str)) {
    return `${defaultProject}\\Sprint ${str}`;
  }
  if (str.toLowerCase().startsWith('sprint ')) {
    return `${defaultProject}\\${str}`;
  }
  return `${defaultProject}\\Sprint ${str}`;
}

/**
 * Resolves dynamic iteration path from sprint number and project prefix with offset.
 */
export function resolveDynamicIteration(
  currentSprintNumber: number,
  projectPrefix: string,
  offset = 0
): { path: string; sprintNumber: number } {
  const targetSprint = currentSprintNumber + offset;
  return {
    path: `${projectPrefix}\\Sprint ${targetSprint}`,
    sprintNumber: targetSprint,
  };
}

/**
 * Calculates start and end dates and duration for an agile sprint window.
 */
export function calculateSprintDateWindow(
  startDateIso: string,
  durationDays = 14
): { start: Date; end: Date; durationDays: number } {
  const start = new Date(startDateIso);
  const end = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000 - 1);
  return {
    start,
    end,
    durationDays,
  };
}

/**
 * Safely escapes single quotes in iteration paths for WIQL queries.
 */
export function escapeWiqlIterationPath(iterationPath: string): string {
  return iterationPath.replaceAll("'", "''");
}
