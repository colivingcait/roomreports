import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const REGION = process.env.DO_SPACES_REGION || 'nyc3';
const ENDPOINT = process.env.DO_SPACES_ENDPOINT || `https://${REGION}.digitaloceanspaces.com`;

const s3 = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
  forcePathStyle: false,
});

const BUCKET = process.env.DO_SPACES_BUCKET;

function publicUrl(key) {
  return `https://${BUCKET}.${REGION}.digitaloceanspaces.com/${key}`;
}

export async function uploadFile(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    ACL: 'public-read',
  }));

  return {
    key,
    url: publicUrl(key),
  };
}

export async function deleteFile(key) {
  await s3.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));
}

export async function getSignedFileUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn });
}
