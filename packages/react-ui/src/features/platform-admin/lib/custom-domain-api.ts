import { api } from '@/lib/api';
import {
  AddDomainRequest,
  CustomDomain,
  ListCustomDomainsRequest,
} from '@activepieces/ee-shared';
import { SeekPage } from '@activepieces/shared';

export const customDomainApi = {
  list(request?: ListCustomDomainsRequest) {
    return api.get<SeekPage<CustomDomain>>('/v1/custom-domains', request);
  },
  create(request: AddDomainRequest) {
    return api.post<CustomDomain>('/v1/custom-domains', request);
  },
  delete(id: string) {
    return api.delete<void>(`/v1/custom-domains/${id}`);
  },
};
