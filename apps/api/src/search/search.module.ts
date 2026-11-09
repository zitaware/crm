import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { SearchService } from './search.service';

@Module({
  imports: [ProjectsModule],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
