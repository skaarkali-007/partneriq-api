import jwt from 'jsonwebtoken';
import { IUser } from '../../models/User';

// Set environment variables before importing the module
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

import { 
  generateTokenPair, 
  verifyAccessToken, 
  verifyRefreshToken, 
  extractTokenFromHeader,
  JWTPayload 
} from '../jwt';

describe('JWT Utilities', () => {
  const mockUser = {
    _id: '507f1f77bcf86cd799439011',
    email: 'test@example.com',
    role: 'marketer'
  } as IUser;

  describe('generateTokenPair', () => {
    it('should generate access and refresh tokens', () => {
      const tokens = generateTokenPair(mockUser);

      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(typeof tokens.accessToken).toBe('string');
      expect(typeof tokens.refreshToken).toBe('string');
      expect(tokens.accessToken).not.toBe(tokens.refreshToken);
    });

    it('should include correct payload in access token', () => {
      const tokens = generateTokenPair(mockUser);
      const decoded = jwt.verify(tokens.accessToken, 'test-jwt-secret') as JWTPayload;

      expect(decoded.userId).toBe(mockUser._id);
      expect(decoded.email).toBe(mockUser.email);
      expect(decoded.role).toBe(mockUser.role);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should include correct payload in refresh token', () => {
      const tokens = generateTokenPair(mockUser);
      const decoded = jwt.verify(tokens.refreshToken, 'test-refresh-secret') as JWTPayload;

      expect(decoded.userId).toBe(mockUser._id);
      expect(decoded.email).toBe(mockUser.email);
      expect(decoded.role).toBe(mockUser.role);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should set correct issuer and audience', () => {
      const tokens = generateTokenPair(mockUser);
      const accessDecoded = jwt.verify(tokens.accessToken, 'test-jwt-secret') as any;
      const refreshDecoded = jwt.verify(tokens.refreshToken, 'test-refresh-secret') as any;

      expect(accessDecoded.iss).toBe('financial-affiliate-platform');
      expect(accessDecoded.aud).toBe('financial-affiliate-users');
      expect(refreshDecoded.iss).toBe('financial-affiliate-platform');
      expect(refreshDecoded.aud).toBe('financial-affiliate-users');
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify valid access token', () => {
      const tokens = generateTokenPair(mockUser);
      const payload = verifyAccessToken(tokens.accessToken);

      expect(payload.userId).toBe(mockUser._id);
      expect(payload.email).toBe(mockUser.email);
      expect(payload.role).toBe(mockUser.role);
    });

    it('should throw error for invalid token', () => {
      expect(() => {
        verifyAccessToken('invalid-token');
      }).toThrow('Invalid or expired access token');
    });

    it('should throw error for expired token', () => {
      const expiredToken = jwt.sign(
        { userId: mockUser._id, email: mockUser.email, role: mockUser.role },
        'test-jwt-secret',
        { expiresIn: '-1s', issuer: 'financial-affiliate-platform', audience: 'financial-affiliate-users' }
      );

      expect(() => {
        verifyAccessToken(expiredToken);
      }).toThrow('Invalid or expired access token');
    });

    it('should throw error for token with wrong secret', () => {
      const wrongSecretToken = jwt.sign(
        { userId: mockUser._id, email: mockUser.email, role: mockUser.role },
        'wrong-secret',
        { expiresIn: '15m', issuer: 'financial-affiliate-platform', audience: 'financial-affiliate-users' }
      );

      expect(() => {
        verifyAccessToken(wrongSecretToken);
      }).toThrow('Invalid or expired access token');
    });

    it('should throw error for token with wrong issuer', () => {
      const wrongIssuerToken = jwt.sign(
        { userId: mockUser._id, email: mockUser.email, role: mockUser.role },
        'test-jwt-secret',
        { expiresIn: '15m', issuer: 'wrong-issuer', audience: 'financial-affiliate-users' }
      );

      expect(() => {
        verifyAccessToken(wrongIssuerToken);
      }).toThrow('Invalid or expired access token');
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify valid refresh token', () => {
      const tokens = generateTokenPair(mockUser);
      const payload = verifyRefreshToken(tokens.refreshToken);

      expect(payload.userId).toBe(mockUser._id);
      expect(payload.email).toBe(mockUser.email);
      expect(payload.role).toBe(mockUser.role);
    });

    it('should throw error for invalid token', () => {
      expect(() => {
        verifyRefreshToken('invalid-token');
      }).toThrow('Invalid or expired refresh token');
    });

    it('should throw error for expired token', () => {
      const expiredToken = jwt.sign(
        { userId: mockUser._id, email: mockUser.email, role: mockUser.role },
        'test-refresh-secret',
        { expiresIn: '-1s', issuer: 'financial-affiliate-platform', audience: 'financial-affiliate-users' }
      );

      expect(() => {
        verifyRefreshToken(expiredToken);
      }).toThrow('Invalid or expired refresh token');
    });

    it('should throw error for access token used as refresh token', () => {
      const tokens = generateTokenPair(mockUser);

      expect(() => {
        verifyRefreshToken(tokens.accessToken);
      }).toThrow('Invalid or expired refresh token');
    });
  });

  describe('extractTokenFromHeader', () => {
    it('should extract token from valid Bearer header', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const header = `Bearer ${token}`;
      
      const extracted = extractTokenFromHeader(header);
      
      expect(extracted).toBe(token);
    });

    it('should return null for undefined header', () => {
      const extracted = extractTokenFromHeader(undefined);
      
      expect(extracted).toBeNull();
    });

    it('should return null for empty header', () => {
      const extracted = extractTokenFromHeader('');
      
      expect(extracted).toBeNull();
    });

    it('should return null for header without Bearer prefix', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const extracted = extractTokenFromHeader(token);
      
      expect(extracted).toBeNull();
    });

    it('should return null for malformed Bearer header', () => {
      const extracted = extractTokenFromHeader('Bearer');
      
      expect(extracted).toBeNull();
    });

    it('should handle Bearer header with extra spaces', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const header = `Bearer  ${token}`;
      
      const extracted = extractTokenFromHeader(header);
      
      expect(extracted).toBe(` ${token}`); // Should include the extra space
    });
  });
});