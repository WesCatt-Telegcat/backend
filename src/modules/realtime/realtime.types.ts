import type { Socket } from 'socket.io';
import type { AuthUser } from '../auth/auth.types';

export type AuthenticatedSocket = Socket & {
  data: {
    user: AuthUser;
  };
};

export type RealtimeMessage = {
  id: string;
  sequence: string;
  clientId: string | null;
  senderId: string;
  receiverId: string;
  encryptedContent: string;
  encryptionIv: string;
  encryptionVersion: string;
  createdAt: Date;
};

export type RealtimeFriendRequest = {
  id: string;
  createdAt: Date;
  requester: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
    friendCode: string;
  };
};
