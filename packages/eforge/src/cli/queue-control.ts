import type { Command } from 'commander';
import { apiRemoveQueueItem, apiUpdateQueuePriority } from '@eforge-build/client';
import { formatCliError } from './errors.js';

function printQueueControlError(err: unknown): never {
  const { message, exitCode } = formatCliError(err);
  console.error(`Error: ${message}`);
  process.exit(exitCode);
}

export function registerQueueControlCommands(queue: Command): void {
  queue
    .command('priority <prdId> <priority>')
    .description('Update the priority for a pending or waiting PRD queue item')
    .action(async (prdId: string, rawPriority: string) => {
      try {
        if (rawPriority.trim() === '') {
          throw new Error('priority must be a finite integer');
        }
        const priority = Number(rawPriority);
        if (!Number.isFinite(priority) || !Number.isInteger(priority)) {
          throw new Error('priority must be a finite integer');
        }
        const { data } = await apiUpdateQueuePriority({ cwd: process.cwd(), prdId, priority });
        console.log(`Queue priority updated: ${data.id} -> ${data.priority}`);
      } catch (err) {
        printQueueControlError(err);
      }
    });

  queue
    .command('remove <prdId>')
    .description('Remove a non-running PRD queue item')
    .action(async (prdId: string) => {
      try {
        const { data } = await apiRemoveQueueItem({ cwd: process.cwd(), prdId });
        console.log(`Queue item removed: ${data.id} removed (previous: ${data.previousStatus})`);
        if (data.removedSidecars.length > 0) {
          console.log(`Removed sidecars: ${data.removedSidecars.join(', ')}`);
        }
      } catch (err) {
        printQueueControlError(err);
      }
    });
}
