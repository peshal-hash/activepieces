import { FullLogo } from '@/components/ui/full-logo';
import { ResetPasswordForm } from '@/features/authentication/components/reset-password-form';

const ResetPasswordPage = () => {
  return (
    <div className="mx-auto flex min-h-screen w-full flex-col items-center justify-center gap-2 px-4 py-8">
      <FullLogo />
      <ResetPasswordForm />
    </div>
  );
};

export { ResetPasswordPage };
