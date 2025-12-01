// scripts/storage-backup.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE;
if (!supabaseUrl || !serviceRole) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE');
  process.exit(1);
}

const outDir = process.argv[2] || 'storage-backup';
fs.mkdirSync(outDir, { recursive: true });

const supabase = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false },
});

// Recursively list all files within a bucket, handling folders & pagination
async function listAll(bucket, prefix = '') {
  const results = [];
  const stack = [prefix];

  while (stack.length) {
    const current = stack.pop();
    let offset = 0;
    const limit = 1000;

    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(current || '', {
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;

      for (const entry of data) {
        const p = current ? `${current}/${entry.name}` : entry.name;
        // Files typically have id/metadata; folders don't. Good enough heuristic.
        if (entry.id || entry.metadata) {
          results.push(p);
        } else {
          stack.push(p);
        }
      }
      if (data.length < limit) break;
      offset += limit;
    }
  }
  return results;
}

async function main() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;

  for (const b of buckets) {
    const bucket = b.name;
    const bucketDir = path.join(outDir, bucket);
    fs.mkdirSync(bucketDir, { recursive: true });

    const files = await listAll(bucket, '');
    for (const filePath of files) {
      const dest = path.join(bucketDir, filePath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });

      const { data, error: dlErr } = await supabase.storage.from(bucket).download(filePath);
      if (dlErr) throw dlErr;

      const buf = Buffer.from(await data.arrayBuffer());
      fs.writeFileSync(dest, buf);
      process.stdout.write(`Downloaded: ${bucket}/${filePath}\n`);
    }
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
    project: supabaseUrl,
    generated_at: new Date().toISOString(),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
