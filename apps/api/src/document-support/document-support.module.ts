import { Module } from '@nestjs/common';
import { DocumentSupportService } from './document-support.service';

@Module({
  providers: [DocumentSupportService],
  exports: [DocumentSupportService],
})
export class DocumentSupportModule {}
