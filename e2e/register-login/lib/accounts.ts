export interface AccountDefinition {
  readonly email: string;
  readonly name: string;
  readonly roleDescription: string;
}

export const OLD_ACCOUNT: AccountDefinition = {
  email: 'liam25e2b@ycalstore.shop',
  name: 'Liam Duplicate Attempt',
  roleDescription: 'Negative duplicate registration test',
} as const;

export const NEW_ACCOUNT: AccountDefinition = {
  email: 'ethan9b21b@ultrmigos.online',
  name: 'Ethan Test User',
  roleDescription: 'Fresh happy path: registration, email verification, authenticated login',
} as const;

export const INBOX_URL = `https://generator.email/${NEW_ACCOUNT.email}`;
export const INVALID_TEST_PASSWORD = 'InvalidPassword999!';
