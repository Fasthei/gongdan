import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateBlobSASQueryParameters, BlobSASPermissions, StorageSharedKeyCredential } from '@azure/storage-blob';

@Injectable()
export class AttachmentService {
  constructor(private config: ConfigService) {}

  async generateSasToken(fileName: string): Promise<{ sasUrl: string; expiresAt: Date }> {
    const accountName = this.config.get<string>('AZURE_STORAGE_ACCOUNT_NAME');
    const accountKey = this.config.get<string>('AZURE_STORAGE_ACCOUNT_KEY');
    const containerName = this.config.get<string>('AZURE_STORAGE_CONTAINER_NAME') || 'attachments';

    // 本地开发时返回 mock
    if (!accountName || !accountKey) {
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      return { sasUrl: `https://mock-storage/${containerName}/${fileName}?mock=true`, expiresAt };
    }

    const credential = new StorageSharedKeyCredential(accountName, accountKey);
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1小时

    const sasParams = generateBlobSASQueryParameters(
      {
        containerName,
        blobName: fileName,
        permissions: BlobSASPermissions.parse('w'), // 仅写入
        expiresOn: expiresAt,
      },
      credential,
    );

    const sasUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${fileName}?${sasParams.toString()}`;
    return { sasUrl, expiresAt };
  }
}
