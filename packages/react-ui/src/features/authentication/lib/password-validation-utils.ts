import { t } from 'i18next';

const MIN_LENGTH = 3;
const MAX_LENGTH = 64;


type ValidationRule = {
  label: string;
  condition: (password: string) => boolean;
};

const validationMessages = {
  minLength: t(`Password must be at least ${MIN_LENGTH} characters long`),
  maxLength: t(`Password can't be more than ${MAX_LENGTH} characters long`),
};

const passwordRules: ValidationRule[] = [
  {
    label: t('3-64 Characters'),
    condition: (password: string) =>
      password.length >= MIN_LENGTH && password.length <= MAX_LENGTH,
  }
];

const passwordValidation = {
  minLength: (value: string) =>
    value.length >= MIN_LENGTH || validationMessages.minLength,
  maxLength: (value: string) =>
    value.length <= MAX_LENGTH || validationMessages.maxLength,
};

export { passwordValidation, passwordRules };
