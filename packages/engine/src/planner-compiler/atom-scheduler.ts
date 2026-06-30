import type { PlanningAtomGraph } from './atom-graph.js';

export interface SelectReadyPlanningAtomsInput {
  graph: PlanningAtomGraph;
  completedAtomIds?: Iterable<string>;
  failedAtomIds?: Iterable<string>;
  runningAtomIds?: Iterable<string>;
  skippedAtomIds?: Iterable<string>;
  parallelism?: number;
}

export interface BlockedPlanningAtom { atomId: string; blockedByAtomIds: string[] }
export interface PlanningAtomScheduleDecision { readyAtomIds: string[]; blockedAtoms: BlockedPlanningAtom[]; terminalAtomIds: string[]; activeAtomIds: string[]; parallelism: number }

export function selectReadyPlanningAtoms(input: SelectReadyPlanningAtomsInput): PlanningAtomScheduleDecision {
  const completed = new Set(input.completedAtomIds ?? []);
  const failed = new Set(input.failedAtomIds ?? []);
  const running = new Set(input.runningAtomIds ?? []);
  const skipped = new Set(input.skippedAtomIds ?? []);
  const terminal = unionSets(completed, failed, skipped);
  const active = new Set([...terminal, ...running]);
  const dependencyMap = incomingDependencies(input.graph);
  const blockedAtoms: BlockedPlanningAtom[] = [];
  const candidates: string[] = [];

  for (const atom of [...input.graph.atoms].sort((a, b) => a.atomId.localeCompare(b.atomId))) {
    if (active.has(atom.atomId)) continue;
    const blockedByAtomIds = (dependencyMap.get(atom.atomId) ?? []).filter((dependencyId) => !completed.has(dependencyId));
    if (blockedByAtomIds.length > 0) blockedAtoms.push({ atomId: atom.atomId, blockedByAtomIds });
    else candidates.push(atom.atomId);
  }

  const parallelism = input.parallelism ?? input.graph.limits.parallelism;
  const capacity = Math.max(0, parallelism - running.size);
  return {
    readyAtomIds: candidates.slice(0, capacity),
    blockedAtoms,
    terminalAtomIds: [...terminal].sort(),
    activeAtomIds: [...active].sort(),
    parallelism,
  };
}

function incomingDependencies(graph: PlanningAtomGraph): Map<string, string[]> {
  const byAtom = new Map(graph.atoms.map((atom) => [atom.atomId, [] as string[]]));
  for (const edge of graph.edges) {
    if (!byAtom.has(edge.toAtomId)) byAtom.set(edge.toAtomId, []);
    byAtom.get(edge.toAtomId)?.push(edge.fromAtomId);
  }
  return new Map([...byAtom.entries()].map(([atomId, dependencies]) => [atomId, [...new Set(dependencies)].sort()]));
}

function unionSets(...sets: Array<Set<string>>): Set<string> {
  return new Set(sets.flatMap((set) => [...set]));
}
