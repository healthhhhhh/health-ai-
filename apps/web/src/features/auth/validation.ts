export interface SignInValues {
  email: string;
  password: string;
}

export type SignInErrors = Partial<Record<keyof SignInValues, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSignIn({ email, password }: SignInValues): SignInErrors {
  const errors: SignInErrors = {};
  if (!email.trim()) errors.email = "Enter your email address.";
  else if (!EMAIL.test(email.trim())) errors.email = "Enter a valid email address.";
  if (!password) errors.password = "Enter your password.";
  else if (password.length < 8) errors.password = "Passwords are at least 8 characters.";
  return errors;
}
