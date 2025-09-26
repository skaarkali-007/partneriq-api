# ProfileService Cloudinary Integration

## Overview
Updated the ProfileService to use Cloudinary cloud storage for KYC document uploads instead of local file storage, while maintaining end-to-end encryption for security.

## Key Changes

### 1. Updated Dependencies
- **Added**: `cloudinaryService` import from `../cloudinary`
- **Removed**: `fs/promises` and `path` imports (no longer needed for local storage)

### 2. Enhanced Security Model
- **Client-side encryption**: Files are encrypted before uploading to Cloudinary
- **Secure storage**: Encryption keys stored separately in the database
- **IV prepending**: Initialization Vector (IV) is prepended to encrypted data for proper decryption

### 3. Modified Methods

#### `uploadKYCDocument()`
**Before**: Saved encrypted files to local filesystem
**After**: 
- Encrypts file content with AES-256-CBC
- Uploads encrypted buffer to Cloudinary
- Stores Cloudinary public_id as filename
- Stores Cloudinary secure_url as encryptedPath

#### `getKYCDocument()`
**Before**: Read encrypted file from local filesystem
**After**:
- Downloads encrypted file from Cloudinary URL
- Extracts IV from first 16 bytes of downloaded data
- Decrypts content using stored encryption key

#### `deleteKYCDocument()`
**Before**: Deleted file from local filesystem
**After**:
- Deletes file from Cloudinary using public_id
- Graceful fallback if Cloudinary deletion fails
- Removes document record from database

#### `getKYCDocumentUrl()` (New)
- Generates secure Cloudinary URLs with transformations
- Useful for admin previews without full decryption
- Falls back to stored URL if Cloudinary is unavailable

### 4. Data Model Updates

#### UserProfile Model (`IKYCDocument` interface)
```typescript
{
  filename: string;      // Now stores Cloudinary public_id
  encryptedPath: string; // Now stores Cloudinary secure_url
  // ... other fields remain the same
}
```

### 5. Migration Support

#### ProfileMigration Class (`profileMigration.ts`)
- **Automated migration** from local storage to Cloudinary
- **Batch processing** for all user profiles
- **Error handling** and detailed reporting
- **Rollback capabilities** for safe migration
- **CLI script**: `npm run migrate:profiles`

## Security Features

### 1. End-to-End Encryption
- Files are encrypted before leaving the server
- Cloudinary only stores encrypted data
- Encryption keys never leave the database

### 2. Access Control
- Admin-only access to document retrieval
- Role-based authorization checks
- Audit logging for all document access

### 3. Secure URLs
- Cloudinary secure HTTPS URLs
- Optional transformations for optimization
- Time-limited access (can be configured)

## File Organization

```
Cloudinary Structure:
kyc/
├── {userId1}/
│   ├── government_id_timestamp1.jpg (encrypted)
│   ├── proof_of_address_timestamp2.pdf (encrypted)
│   └── ...
├── {userId2}/
│   └── ...
└── ...
```

## API Changes

### Enhanced Methods
All existing ProfileService methods maintain the same interface but now use Cloudinary:

```typescript
// Upload (same interface, now uses Cloudinary)
ProfileService.uploadKYCDocument(userId, documentData)

// Retrieve (same interface, now downloads from Cloudinary)
ProfileService.getKYCDocument(userId, documentId, requesterId)

// Delete (same interface, now deletes from Cloudinary)
ProfileService.deleteKYCDocument(userId, documentId)
```

### New Methods
```typescript
// Get secure URL for admin preview
ProfileService.getKYCDocumentUrl(userId, documentId, requesterId)
```

## Migration Process

### 1. Automatic Migration
```bash
npm run migrate:profiles
```

### 2. Manual Migration
```typescript
import { ProfileMigration } from './services/user/profileMigration';

const results = await ProfileMigration.migrateAllKYCDocuments();
ProfileMigration.generateMigrationReport(results);
```

### 3. Rollback (if needed)
```typescript
await ProfileMigration.rollbackProfileMigration(userId, backupData);
```

## Error Handling

### 1. Configuration Errors
- Checks if Cloudinary is properly configured
- Graceful error messages for missing configuration
- Fallback behavior when Cloudinary is unavailable

### 2. Upload Failures
- Detailed error logging
- User-friendly error messages
- Automatic cleanup on partial failures

### 3. Retrieval Failures
- Network error handling
- Decryption error handling
- Fallback to stored URLs when possible

## Performance Considerations

### 1. File Size Optimization
- Cloudinary automatic optimization
- Quality settings for different file types
- Format conversion for better compression

### 2. CDN Benefits
- Global CDN distribution
- Faster file access worldwide
- Reduced server bandwidth usage

### 3. Caching
- Cloudinary edge caching
- Browser caching for static assets
- Reduced database queries for file access

## Testing

### 1. Unit Tests
- Comprehensive test coverage in `profileService.cloudinary.test.ts`
- Mock Cloudinary service for isolated testing
- Error scenario testing

### 2. Integration Tests
- End-to-end encryption/decryption testing
- Migration testing with sample data
- Performance testing with large files

## Monitoring and Maintenance

### 1. Logging
- All file operations are logged
- Error tracking and reporting
- Admin access audit trail

### 2. Cloudinary Usage
- Monitor storage usage through Cloudinary dashboard
- Set up usage alerts
- Regular cleanup of unused files

### 3. Security Audits
- Regular encryption key rotation (recommended)
- Access pattern monitoring
- Compliance reporting

## Best Practices

### 1. Encryption Key Management
- Store encryption keys securely
- Consider using a dedicated key management service
- Implement key rotation policies

### 2. File Retention
- Implement file retention policies
- Automatic cleanup of old documents
- Compliance with data protection regulations

### 3. Backup Strategy
- Regular backups of document metadata
- Cloudinary automatic backups
- Disaster recovery procedures

## Future Enhancements

### 1. Advanced Security
- Client-side encryption before upload
- Hardware security module (HSM) integration
- Multi-layer encryption

### 2. Advanced Features
- Document versioning
- Digital signatures
- OCR and document analysis

### 3. Performance Optimization
- Lazy loading for large document sets
- Progressive image loading
- Advanced caching strategies