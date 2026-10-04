/** Atlas — repository-native project management. */
export interface Project {
  name: string;
  wikiRoot: string;
  taskRoot: string;
}

export const project: Project = {
  name: 'Atlas',
  wikiRoot: 'docs',
  taskRoot: 'tasks',
};

export function describeProject(value: Project): string {
  return `${value.name}: documentation, delivery, and code in one place.`;
}
