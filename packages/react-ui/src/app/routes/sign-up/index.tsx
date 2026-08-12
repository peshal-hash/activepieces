import { FullLogo } from '@/components/ui/full-logo';
import { AuthFormTemplate } from '@/features/authentication/components/auth-form-template';

const SignUpPage: React.FC = () => {
  return (
    <div className="mx-auto flex min-h-screen w-full flex-col items-center justify-center gap-2 px-4 py-8">
      <FullLogo />
      <AuthFormTemplate form={'signup'} />
    </div>
  );
};

SignUpPage.displayName = 'SignUpPage';

export { SignUpPage };
