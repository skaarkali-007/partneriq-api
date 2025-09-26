import fs from 'fs/promises';
import { UserProfile } from '../../models/UserProfile';
import { cloudinaryService } from '../cloudinary';
import { logger } from '../../utils/logger';

export interface ProfileMigrationResult {
  success: boolean;
  userId: string;
  documentId: string;
  oldPath: string;
  newUrl?: string;
  error?: string;
}

export class ProfileMigration {
  /**
   * Migrate all KYC documents from local storage to Cloudinary
   */
  public static async migrateAllKYCDocuments(): Promise<ProfileMigrationResult[]> {
    const results: ProfileMigrationResult[] = [];
    
    try {
      // Find all user profiles with KYC documents
      const profiles = await UserProfile.find({
        'kycDocuments.0': { $exists: true }
      }).select('+kycDocuments.encryptionKey');

      logger.info(`Found ${profiles.length} user profiles with KYC documents`);

      for (const profile of profiles) {
        const profileResults = await this.migrateProfileDocuments(profile);
        results.push(...profileResults);
      }

      return results;
    } catch (error) {
      logger.error('Error during profile migration:', error);
      throw error;
    }
  }

  /**
   * Migrate KYC documents for a specific user profile
   */
  public static async migrateProfileDocuments(profile: any): Promise<ProfileMigrationResult[]> {
    const results: ProfileMigrationResult[] = [];

    for (const document of profile.kycDocuments) {
      const result = await this.migrateDocument(profile.userId.toString(), document);
      results.push(result);

      // If migration was successful, update the document in the database
      if (result.success && result.newUrl) {
        const docIndex = profile.kycDocuments.findIndex(
          (doc: any) => doc._id.toString() === document._id.toString()
        );
        
        if (docIndex !== -1) {
          // Update with Cloudinary information
          profile.kycDocuments[docIndex].encryptedPath = result.newUrl;
          profile.kycDocuments[docIndex].filename = this.extractPublicIdFromUrl(result.newUrl);
        }
      }
    }

    // Save the updated profile
    if (results.some(r => r.success)) {
      await profile.save();
      logger.info(`Updated user profile ${profile.userId} with new Cloudinary URLs`);
    }

    return results;
  }

  /**
   * Migrate a single KYC document
   */
  private static async migrateDocument(userId: string, document: any): Promise<ProfileMigrationResult> {
    const result: ProfileMigrationResult = {
      success: false,
      userId,
      documentId: document._id.toString(),
      oldPath: document.encryptedPath
    };

    try {
      // Check if document is already on Cloudinary
      if (document.encryptedPath.includes('cloudinary.com')) {
        result.success = true;
        result.newUrl = document.encryptedPath;
        return result;
      }

      // Check if local file exists
      const localPath = document.encryptedPath;
      try {
        await fs.access(localPath);
      } catch {
        result.error = 'Local file not found';
        return result;
      }

      // Read encrypted file buffer
      const encryptedBuffer = await fs.readFile(localPath);

      // Upload to Cloudinary (the file is already encrypted)
      const uploadResult = await cloudinaryService.uploadKYCDocument(
        encryptedBuffer,
        document.type,
        userId,
        document.originalName
      );

      result.success = true;
      result.newUrl = uploadResult.secure_url;

      logger.info(`Migrated KYC document ${document._id} for user ${userId}`);

      // Optionally delete local file after successful upload
      // await fs.unlink(localPath);

    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to migrate KYC document ${document._id}:`, error);
    }

    return result;
  }

  /**
   * Extract Cloudinary public ID from URL
   */
  private static extractPublicIdFromUrl(url: string): string {
    const matches = url.match(/\/v\d+\/(.+)\.[^.]+$/);
    return matches ? matches[1] : '';
  }

  /**
   * Generate migration report
   */
  public static generateMigrationReport(results: ProfileMigrationResult[]): void {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log('\n=== PROFILE KYC MIGRATION REPORT ===');
    console.log(`Total documents processed: ${results.length}`);
    console.log(`Successfully migrated: ${successful.length}`);
    console.log(`Failed migrations: ${failed.length}`);

    if (failed.length > 0) {
      console.log('\nFailed migrations:');
      failed.forEach(result => {
        console.log(`- User: ${result.userId}, Document: ${result.documentId}, Error: ${result.error}`);
      });
    }

    console.log('\n=== END REPORT ===\n');
  }

  /**
   * Rollback migration for a specific user profile
   */
  public static async rollbackProfileMigration(userId: string, backupData: any): Promise<void> {
    try {
      const profile = await UserProfile.findOne({ userId });
      if (!profile) {
        throw new Error('User profile not found');
      }

      // Restore original document information
      profile.kycDocuments = backupData.kycDocuments;
      await profile.save();

      logger.info(`Rolled back migration for user profile ${userId}`);
    } catch (error) {
      logger.error(`Failed to rollback migration for user profile ${userId}:`, error);
      throw error;
    }
  }
}

// CLI script for running migration
if (require.main === module) {
  async function runProfileMigration() {
    try {
      console.log('Starting user profile KYC document migration to Cloudinary...');
      
      if (!cloudinaryService.isReady()) {
        throw new Error('Cloudinary is not configured. Please set environment variables.');
      }

      const results = await ProfileMigration.migrateAllKYCDocuments();
      ProfileMigration.generateMigrationReport(results);
      
      console.log('Profile migration completed!');
      process.exit(0);
    } catch (error) {
      console.error('Profile migration failed:', error);
      process.exit(1);
    }
  }

  runProfileMigration();
}