import { BaseCommand } from './base-command.js';
import { getLabelDetails } from '../types/labels.types.js';

/**
 * SetupLabelsCommand creates rig labels on the GitHub repository.
 *
 * Uses `gh label create --force` so it's safe to run multiple times.
 * Labels that already exist will be updated with the configured color/description.
 */
export class SetupLabelsCommand extends BaseCommand {
  /**
   * Executes the setup-labels command.
   *
   * Requires GitHub CLI authentication. Creates all labels defined
   * in labels.types.ts on the current repository.
   */
  async execute(): Promise<void> {
    await this.guard.requireGhAuth();

    this.logger.header('Setting up GitHub labels');
    console.log('');

    const labels = getLabelDetails();
    this.logger.info(`Syncing ${labels.length} labels to repository...`);

    const result = await this.github.syncLabels(labels);

    if (result.created.length > 0) {
      this.logger.success(`Created ${result.created.length} new labels`);
    }
    if (result.existing.length > 0) {
      this.logger.dim(`Updated ${result.existing.length} existing labels`);
    }

    console.log('');
    this.logger.success('Label setup complete!');
  }
}
