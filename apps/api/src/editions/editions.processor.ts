import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EDITION_QUEUE } from '../queue/queue.module.js';
import { EditionsService, type EditionInvitesJob } from './editions.service.js';

/** Invitation des équipes de l'édition précédente, dans le worker. */
@Processor(EDITION_QUEUE)
export class EditionsProcessor extends WorkerHost {
  constructor(private readonly editions: EditionsService) {
    super();
  }

  process(job: Job<EditionInvitesJob>): Promise<number> {
    return this.editions.inviteTeams(job.data.tournamentId);
  }
}
