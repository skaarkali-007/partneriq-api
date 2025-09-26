# Cloudinary Integration

This service provides file upload and management capabilities using Cloudinary for the Partner IQ platform.

## Setup

1. **Create a Cloudinary Account**
   - Go to [Cloudinary](https://cloudinary.com) and create a free account
   - Navigate to your Dashboard to get your credentials

2. **Configure Environment Variables**
   Add the following to your `.env` file:
   ```env
   CLOUDINARY_CLOUD_NAME=your-cloud-name
   CLOUDINARY_API_KEY=your-api-key
   CLOUDINARY_API_SECRET=your-api-secret
   ```

3. **Install Dependencies**
   The `cloudinary` package is already installed. If you need to install it manually:
   ```bash
   npm install cloudinary
   ```

## Features

### File Upload
- **Buffer Upload**: Upload files from memory buffers (used for multer integration)
- **File Path Upload**: Upload files from local file paths
- **Multiple File Upload**: Upload multiple files in batch
- **KYC Document Upload**: Specialized upload for KYC documents with proper folder structure

### File Management
- **Delete Files**: Remove files from Cloudinary
- **Get File Details**: Retrieve file metadata
- **Generate Secure URLs**: Create secure URLs with transformations

### Transformations
- **Quality Optimization**: Automatic quality optimization
- **Format Conversion**: Automatic format conversion for better performance
- **Custom Transformations**: Apply custom transformations as needed

## Usage

### Basic Upload
```typescript
import { cloudinaryService } from '../services/cloudinary';

// Upload a buffer
const result = await cloudinaryService.uploadBuffer(fileBuffer, {
  folder: 'uploads',
  resource_type: 'auto'
});

// Upload a file
const result = await cloudinaryService.uploadFile('/path/to/file.jpg', {
  folder: 'uploads'
});
```

### KYC Document Upload
```typescript
const result = await cloudinaryService.uploadKYCDocument(
  fileBuffer,
  'government_id',
  'customer123',
  'passport.jpg'
);
```

### File Management
```typescript
// Delete a file
await cloudinaryService.deleteFile('public_id');

// Get file details
const details = await cloudinaryService.getFileDetails('public_id');

// Generate secure URL with transformations
const url = cloudinaryService.generateSecureUrl('public_id', [
  { quality: 'auto:good' },
  { fetch_format: 'auto' }
]);
```

## File Organization

Files are organized in the following folder structure:
- `kyc/{customerId}/` - KYC documents for each customer
- `uploads/` - General uploads

## Security

- All uploads use secure HTTPS URLs
- Files are tagged with relevant metadata for easy management
- KYC documents are stored in customer-specific folders
- Automatic quality optimization reduces file sizes while maintaining quality

## Error Handling

The service includes comprehensive error handling:
- Configuration validation
- Upload failure handling
- Network error handling
- Graceful fallbacks when Cloudinary is unavailable

## API Endpoints

### Upload KYC Documents
```
POST /api/customers/onboarding/:customerId/kyc-documents
```

### Get KYC Document
```
GET /api/customers/onboarding/:customerId/kyc-documents/:documentId
```

### Delete KYC Document
```
DELETE /api/customers/onboarding/:customerId/kyc-documents/:documentId
```

## Migration from Local Storage

If you're migrating from local file storage:

1. Update your environment variables with Cloudinary credentials
2. The service will automatically use Cloudinary for new uploads
3. Existing local files will continue to work until migrated
4. Consider running a migration script to move existing files to Cloudinary

## Troubleshooting

### Configuration Issues
- Ensure all environment variables are set correctly
- Check that your Cloudinary account is active
- Verify API credentials in the Cloudinary dashboard

### Upload Failures
- Check file size limits (10MB default)
- Verify file types are allowed
- Check network connectivity
- Review Cloudinary usage limits

### Performance
- Use appropriate transformations to optimize file sizes
- Consider using Cloudinary's CDN for faster delivery
- Monitor usage to stay within plan limits