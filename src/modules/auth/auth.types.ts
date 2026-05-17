export type AuthUser = {
  sub: string;
  email: string;
  name: string;
  friendCode: string;
};

export type SafeUser = {
  id: string;
  email: string;
  name: string;
  friendCode: string;
  friendLink: string;
  avatar: string | null;
  encryptionPublicKey: string | null;
  encryptedPrivateKey: string | null;
  encryptionKeySalt: string | null;
  encryptionKeyIv: string | null;
  encryptionKeyVersion: string | null;
};
