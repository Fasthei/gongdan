import api from '../api/axios';

export async function uploadFileToAttachmentStorage(file: File): Promise<string> {
  const { data } = await api.post('/attachments/sas-token', { fileName: file.name }, { timeout: 10000 });
  await fetch(data.sasUrl, {
    method: 'PUT',
    body: file,
    headers: { 'x-ms-blob-type': 'BlockBlob' },
  });
  return String(data.sasUrl).split('?')[0];
}

