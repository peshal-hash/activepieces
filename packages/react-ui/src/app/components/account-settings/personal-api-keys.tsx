import { useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import { Clock, Key, Plus, Trash } from 'lucide-react';

import { NewApiKeyDialog } from '@/app/routes/platform/security/api-keys/new-api-key-dialog';
import { ConfirmationDeleteDialog } from '@/components/delete-dialog';
import { Button } from '@/components/ui/button';
import { FormattedDate } from '@/components/ui/formatted-date';
import { internalErrorToast } from '@/components/ui/sonner';
import { userApiKeyApi } from '@/lib/user-api-key-api';

type PersonalApiKeysSectionProps = {
  open: boolean;
};

export const PersonalApiKeysSection = ({
  open,
}: PersonalApiKeysSectionProps) => {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['user-api-keys'],
    queryFn: () => userApiKeyApi.list(),
    enabled: open,
    staleTime: 0,
  });

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold">{t('API Keys')}</div>
          <div className="text-xs text-muted-foreground">
            {t('Create and manage API keys to access Activepieces APIs.')}
          </div>
        </div>

        <NewApiKeyDialog
          createApiKey={(request) => userApiKeyApi.create(request)}
          onCreate={() =>
            queryClient.invalidateQueries({ queryKey: ['user-api-keys'] })
          }
        >
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2 shrink-0"
          >
            <Plus className="size-4" />
            {t('New Api Key')}
          </Button>
        </NewApiKeyDialog>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">{t('Loading...')}</div>
      ) : isError ? (
        <div className="text-sm text-destructive">
          {t('Failed to load API keys')}
        </div>
      ) : data && data.data.length > 0 ? (
        <div className="space-y-2">
          {data.data.map((apiKey) => (
            <div
              key={apiKey.id}
              className="rounded-lg border bg-background px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div className="font-medium truncate">{apiKey.displayName}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {`sk-...${apiKey.truncatedValue}`}
                  </div>

                  <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                    <div className="inline-flex items-center gap-1.5">
                      <Clock className="size-3.5" />
                      <span>{t('Created')}</span>
                      <FormattedDate date={new Date(apiKey.createdAt ?? apiKey.created)} />
                    </div>

                    <div className="inline-flex items-center gap-1.5">
                      <Clock className="size-3.5" />
                      <span>{t('Last Used')}</span>
                      {apiKey.lastUsedAt ? (
                        <FormattedDate date={new Date(apiKey.lastUsedAt)} />
                      ) : (
                        <span>{t('Never')}</span>
                      )}
                    </div>
                  </div>
                </div>

                <ConfirmationDeleteDialog
                  title={t('Delete API Key')}
                  message={t('Are you sure you want to delete this API key?')}
                  entityName={t('API Key')}
                  mutationFn={async () => {
                    await userApiKeyApi.delete(apiKey.id);
                    await queryClient.invalidateQueries({
                      queryKey: ['user-api-keys'],
                    });
                  }}
                  onError={() => {
                    internalErrorToast();
                  }}
                >
                  <Button variant="ghost" className="size-8 p-0 shrink-0">
                    <Trash className="size-4 text-destructive" />
                  </Button>
                </ConfirmationDeleteDialog>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed px-4 py-6 text-center">
          <div className="flex justify-center">
            <Key className="size-8 text-muted-foreground" />
          </div>
          <div className="mt-3 text-sm font-medium">{t('No API keys found')}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t('Start by creating an API key to communicate with Activepieces APIs')}
          </div>
        </div>
      )}
    </section>
  );
};
