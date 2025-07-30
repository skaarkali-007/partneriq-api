import jwt, { SignOptions } from 'jsonwebtoken';
import { IUser } from '../models/User';

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

export const generateTokenPair = (user: IUser): TokenPair => {
  const payload: JWTPayload = {
    userId: user._id,
    email: user.email,
    role: user.role
  };

  const signOptions: SignOptions = {
    expiresIn: JWT_EXPIRES_IN as any,
    issuer: 'financial-affiliate-platform',
    audience: 'financial-affiliate-users'
  };

  const refreshSignOptions: SignOptions = {
    expiresIn: JWT_REFRESH_EXPIRES_IN as any,
    issuer: 'financial-affiliate-platform',
    audience: 'financial-affiliate-users'
  };

  const accessToken = jwt.sign(payload, JWT_SECRET as string, signOptions);
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET as string, refreshSignOptions);

  return { accessToken, refreshToken };
};

export const verifyAccessToken = (token: string): JWTPayload => {
  try {
    return jwt.verify(token, JWT_SECRET as string, {
      issuer: 'financial-affiliate-platform',
      audience: 'financial-affiliate-users'
    }) as JWTPayload;
  } catch (error) {
    throw new Error('Invalid or expired access token');
  }
};

export const verifyRefreshToken = (token: string): JWTPayload => {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET as string, {
      issuer: 'financial-affiliate-platform',
      audience: 'financial-affiliate-users'
    }) as JWTPayload;
  } catch (error) {
    throw new Error('Invalid or expired refresh token');
  }
};

export const extractTokenFromHeader = (authHeader: string | undefined): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
};