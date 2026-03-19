import { api } from '@/lib/api';
import {
  ApiKeyResponseWithoutValue,
  ApiKeyResponseWithValue,
  CreateApiKeyRequest,
} from '@activepieces/ee-shared';
import { SeekPage } from '@activepieces/shared';

export const userApiKeyApi = {
  list() {
    return api.get<SeekPage<ApiKeyResponseWithoutValue>>('/v1/users/me/api-keys');
  },
  delete(keyId: string) {
    return api.delete<void>(`/v1/users/me/api-keys/${keyId}`);
  },
  create(request: CreateApiKeyRequest) {
    return api.post<ApiKeyResponseWithValue>('/v1/users/me/api-keys', request);
  },
};
