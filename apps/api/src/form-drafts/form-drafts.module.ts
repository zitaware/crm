import { Module } from '@nestjs/common';
import { FormDraftsService } from './form-drafts.service';

@Module({
  providers: [FormDraftsService],
  exports: [FormDraftsService],
})
export class FormDraftsModule {}
