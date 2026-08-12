import { FullLogo } from '@/components/ui/full-logo';
import { ChangePasswordForm } from '@/features/authentication/components/change-password';

const ChangePasswordPage = () => {
  return (
    <div className="mx-auto flex min-h-screen w-full flex-col items-center justify-center gap-2 px-4 py-8">
      <FullLogo />
      <ChangePasswordForm />
    </div>
  );
};

export { ChangePasswordPage };
