'use strict';

const fs = require('fs');
const path = require('path');

async function applyAWSS3(targetDir) {
  // 1. Write services/storage.js
  const servicesDir = path.join(targetDir, 'services');
  fs.mkdirSync(servicesDir, { recursive: true });

  const storageServiceContent = `'use strict';

// AWS S3 storage service
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl: awsGetSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET;

async function uploadFile(key, buffer, mimeType, isPublic) {
  const params = {
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  };
  if (isPublic) {
    params.ACL = 'public-read';
  }
  await s3.send(new PutObjectCommand(params));
  if (isPublic) {
    return \`https://\${BUCKET}.s3.\${process.env.AWS_REGION}.amazonaws.com/\${key}\`;
  }
  return key;
} // END uploadFile

async function deleteFile(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
} // END deleteFile

async function getSignedUrl(key, expiresIn) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return awsGetSignedUrl(s3, command, { expiresIn: expiresIn || 3600 });
} // END getSignedUrl

module.exports = {
  uploadFile,
  deleteFile,
  getSignedUrl,
};
`;

  fs.writeFileSync(path.join(servicesDir, 'storage.js'), storageServiceContent);

  // 2. Append to .env.template
  const envTemplatePath = path.join(targetDir, '.env.template');
  const envAdditions = `
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_S3_BUCKET=
`;
  fs.appendFileSync(envTemplatePath, envAdditions);

  // 3. Append AWS SDK packages to dependencies in package.json
  const packageJsonPath = path.join(targetDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies['@aws-sdk/client-s3'] = '3.758.0';
  packageJson.dependencies['@aws-sdk/s3-request-presigner'] = '3.758.0';
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
} // END applyAWSS3

module.exports = { applyAWSS3 };
