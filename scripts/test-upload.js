import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

async function main() {
  const token = process.env.TEST_TOKEN || '';
  const filePath = process.env.TEST_FILE || './test.jpg';
  if (!fs.existsSync(filePath)) {
    console.error('Test file not found:', filePath);
    process.exit(1);
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('description', 'upload test');

  const res = await fetch(process.env.TEST_URL || 'http://localhost:3000/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  console.log('Status:', res.status);
  const body = await res.text();
  console.log('Body:', body);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
