import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectFinancialsService } from './project-financials.service';
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [ClientsModule],
  providers: [ProjectsService, ProjectFinancialsService],
  exports: [ProjectsService, ProjectFinancialsService],
})
export class ProjectsModule {}
